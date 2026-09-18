import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";

/**
 * Many writers, one document, randomized interleavings.
 *
 * Every other test here states a scenario someone thought of. This one does
 * not: it runs the real write paths against each other in orders nobody
 * chose, and checks the two promises the app actually makes, after every
 * round, whatever happened.
 *
 *   ACCEPTED OR REFUSED, NEVER SILENT. A write either returns and its text is
 *   what the document now holds, or it throws PostConflictError. There is no
 *   third outcome where a call returns happily and the words are not there.
 *
 *   THERE IS ALWAYS A WAY BACK. At every moment, some state the document
 *   genuinely held is on file. A burst of small edits by one writer inside
 *   the coalescing window folds into one version deliberately, so not every
 *   keystroke is recoverable; what may never happen is arriving at a document
 *   with nothing behind it.
 *
 * The second is the one that matters. A conflict is an answer; a write that
 * reports success and evaporates with nothing left behind it is the failure
 * this file exists to make impossible, and it is what the owner experienced.
 *
 * Randomized, so it is not the same test twice. TEXTTEXT_CONCURRENCY_SEED
 * pins a seed to reproduce a failure, and TEXTTEXT_CONCURRENCY_ROUNDS turns
 * it up for a longer soak.
 */

const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);
const ROUNDS = Number(process.env.TEXTTEXT_CONCURRENCY_ROUNDS ?? 14);
const SEED = Number(process.env.TEXTTEXT_CONCURRENCY_SEED ?? Date.now() % 1_000_000);

/** A small deterministic generator, so a failing run is reproducible from its seed. */
function randomFrom(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

describe.skipIf(!enabled)("concurrent writers against one document", () => {
  let db: typeof import("@/lib/db/client").db;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  let userId = "";
  let blogId = "";
  let handle = "";
  let folderId = "";
  const random = randomFrom(SEED);

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only local Postgres is allowed");
    ({ db } = await import("@/lib/db/client"));
    schema = await import("@/lib/db/schema");
    store = await import("@/lib/store");
    if (!db) throw new Error("no db");
    const stamp = `${Date.now().toString(36)}-${process.pid}`;
    handle = `concurrency-${stamp}`;
    const [created] = await db
      .insert(schema.users)
      .values({ appleSub: handle, username: handle, email: `${handle}@example.invalid`, name: "Concurrency" })
      .returning({ id: schema.users.id });
    userId = created.id;
    const [blog] = await db.insert(schema.blogs).values({ handle, name: "Concurrency", ownerId: userId }).returning({ id: schema.blogs.id });
    blogId = blog.id;
    await store.ensureWorkspaceFolders(blogId);
    folderId = (await store.getFolders(handle)).find((folder) => folder.mode === "notes")!.id;
  });

  afterAll(async () => {
    if (!db || !blogId) return;
    await db.delete(schema.postRevisions).where(eq(schema.postRevisions.blogId, blogId));
    await db.delete(schema.posts).where(eq(schema.posts.blogId, blogId));
    await db.delete(schema.folders).where(eq(schema.folders.blogId, blogId));
    await db.delete(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, userId));
    await db.delete(schema.blogs).where(eq(schema.blogs.id, blogId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  /** Everything the history holds for an item, plus what it holds right now. */
  async function everyVersionOf(postId: string): Promise<Set<string>> {
    const rows = await db!
      .select({ document: schema.postRevisions.document })
      .from(schema.postRevisions)
      .where(eq(schema.postRevisions.postId, postId))
      .orderBy(desc(schema.postRevisions.createdAt));
    const bodies = new Set<string>();
    for (const row of rows) {
      const body = (row.document as { content?: { body?: string } })?.content?.body;
      if (typeof body === "string") bodies.add(body);
    }
    const current = await store.getPostById(handle, postId);
    if (typeof current?.body === "string") bodies.add(current.body);
    return bodies;
  }

  it("CW-01: every write is accepted or refused, and nothing accepted is lost", async () => {
    const created = await store.createDraftInFolder(handle, folderId, {
      initial: { type: "note", title: "contended", body: "the document as it started" },
    });
    const postId = created.id!;
    const accepted: string[] = ["the document as it started"];
    let conflicts = 0;

    for (let round = 0; round < ROUNDS; round += 1) {
      const base = (await store.getPostById(handle, postId))!;
      const writers = 2 + Math.floor(random() * 3);
      // Every writer reads the same base, which is what two clients that
      // both loaded the item a moment ago actually have.
      const attempts = Array.from({ length: writers }, (_, index) => {
        const body = `round ${round} writer ${index}: ${"the text this writer meant to save ".repeat(1 + Math.floor(random() * 3))}`;
        const patch = random() < 0.5;
        const run = patch
          ? () =>
              store.savePostContentPatch(
                handle,
                base,
                { document: { ...base.document!, content: { ...base.document!.content, body } } },
                { expectedRevision: base.revision },
              )
          : () =>
              store.savePost(
                handle,
                { ...base, document: { ...base.document!, content: { ...base.document!.content, body } }, body },
                { expectedRevision: base.revision, preservePublishedAt: true },
              );
        return { body, run };
      });

      const outcomes = await Promise.all(
        attempts.map(async (attempt) => {
          try {
            const saved = await attempt.run();
            return { body: attempt.body, saved, error: null as unknown };
          } catch (error) {
            return { body: attempt.body, saved: null, error };
          }
        }),
      );

      const winners = outcomes.filter((outcome) => outcome.saved);
      const losers = outcomes.filter((outcome) => !outcome.saved);
      conflicts += losers.length;

      // Refused writers say so, in the one way the app has of saying it.
      for (const loser of losers) {
        expect(
          loser.error instanceof store.PostConflictError,
          `a refused write threw ${String(loser.error)} instead of PostConflictError`,
        ).toBe(true);
      }

      // Guarded on one revision, at most one writer can land. More than one
      // means the compare-and-set is not comparing.
      expect(winners.length, `round ${round}: ${winners.length} writers landed on one revision`).toBeLessThanOrEqual(1);

      if (winners.length === 1) {
        const winner = winners[0]!;
        accepted.push(winner.body);
        const current = (await store.getPostById(handle, postId))!;
        // A write that returns has actually written: the row holds its text.
        expect(current.body, `round ${round}: the accepted write is not what the document holds`).toBe(winner.body);
        // The revision is a workspace-wide sequence, so it moves forward
        // rather than by one.
        expect(
          Number(current.revision),
          `round ${round}: the revision did not advance`,
        ).toBeGreaterThan(Number(base.revision));
        // And it returned the row it wrote, not somebody else's.
        expect(Number(winner.saved!.revision)).toBe(Number(current.revision));
      }

      // The promise: there is always a way back. Some state the document
      // genuinely held, at or before where it is now, is on file.
      const known = await everyVersionOf(postId);
      const recoverable = accepted.filter((body) => known.has(body));
      expect(
        recoverable.length,
        `round ${round}: the document has nothing behind it`,
      ).toBeGreaterThan(0);
      // And the state it started from is never folded away, however long the
      // run goes on.
      expect(
        known.has("the document as it started"),
        `round ${round}: the state this document started from is gone`,
      ).toBe(true);
    }

    // A run where nothing ever collided proves nothing about collisions.
    expect(conflicts, `seed ${SEED}: no write was ever refused, so no interleaving was exercised`).toBeGreaterThan(0);
  });

  it("CW-03: a burst of small edits cannot carry the document away unrecorded", async () => {
    // Each write on its own is typing, and the window is right to fold them.
    // What it may not do is let a thousand of them travel a thousand
    // characters with nothing on file but where they started, which is what
    // comparing each write only with the one before it allowed.
    const created = await store.createDraftInFolder(handle, folderId, {
      initial: { type: "note", title: "drift", body: "start" },
    });
    const postId = created.id!;
    let body = "start";
    for (let keystroke = 0; keystroke < 400; keystroke += 1) {
      body += "x";
      const base = (await store.getPostById(handle, postId))!;
      await store.savePost(
        handle,
        { ...base, document: { ...base.document!, content: { ...base.document!.content, body } }, body },
        { expectedRevision: base.revision, preservePublishedAt: true },
      );
    }
    const known = await everyVersionOf(postId);
    const lengths = [...known].map((value) => value.length).sort((left, right) => left - right);
    const furthest = Math.max(...lengths.map((length) => Math.abs(body.length - length)));
    expect(
      furthest,
      `the nearest version on file is ${furthest} characters from the document, out of ${body.length}`,
    ).toBeLessThan(body.length);
    // Somewhere between the start and here, the burst wrote itself down.
    expect(known.size, "the whole burst folded into one version").toBeGreaterThan(1);
  });

  it("CW-02: an unguarded write cannot erase a guarded one without leaving it behind", async () => {
    const created = await store.createDraftInFolder(handle, folderId, {
      initial: { type: "note", title: "unguarded", body: "before either writer" },
    });
    const postId = created.id!;
    const base = (await store.getPostById(handle, postId))!;
    // Materially different texts, so this is two people saving different work
    // rather than one person typing. A burst of near-identical edits folding
    // together is the window doing its job and is covered by CW-03.
    const guardedBody = `the guarded write: ${"words the first person meant to keep ".repeat(12)}`;
    const unguardedBody = `the unguarded write: ${"something else entirely from a background job ".repeat(12)}`;
    await store.savePost(
      handle,
      { ...base, document: { ...base.document!, content: { ...base.document!.content, body: guardedBody } }, body: guardedBody },
      { expectedRevision: base.revision, preservePublishedAt: true },
    );
    // The second writer read the same row and saves with no expectation at
    // all, which is what a background job does.
    let unguardedLanded = true;
    try {
      await store.savePost(
        handle,
        { ...base, document: { ...base.document!, content: { ...base.document!.content, body: unguardedBody } }, body: unguardedBody },
        { preservePublishedAt: true },
      );
    } catch {
      unguardedLanded = false;
    }
    const known = await everyVersionOf(postId);
    expect(
      known.has(guardedBody),
      unguardedLanded
        ? "the unguarded write replaced the guarded one and the history did not keep it"
        : "the guarded write is not the document's text",
    ).toBe(true);
  });
});
