import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { fakeGithub } from "./fake-github";

// Against local Postgres only (npm run test:reading:db). Scratch workspace,
// removed in afterAll. GitHub is the in-memory fake; the app config comes
// from the environment only if present, so the run sets a throwaway one.
const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("github backup against Postgres", () => {
  let db: typeof import("@/lib/db/client").db;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  let backup: typeof import("@/lib/github/backup.server");
  let userId = "";
  let blogId = "";
  let handle = "";
  let firstId = "";
  let secondId = "";
  const actor = { userId: "", actorType: "human" as const };
  const github = fakeGithub();

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only local Postgres is allowed");
    if (!process.env.GITHUB_APP_PRIVATE_KEY) {
      const { generateKeyPairSync } = await import("node:crypto");
      process.env.AUTH_GITHUB_ID = "test";
      process.env.AUTH_GITHUB_SECRET = "test";
      process.env.GITHUB_APP_ID = "1";
      process.env.GITHUB_APP_SLUG = "test";
      process.env.GITHUB_APP_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    }
    ({ db } = await import("@/lib/db/client"));
    schema = await import("@/lib/db/schema");
    store = await import("@/lib/store");
    backup = await import("@/lib/github/backup.server");
    if (!db) throw new Error("no db");
    const stamp = `${Date.now().toString(36)}-${process.pid}`;
    handle = `backup-test-${stamp}`;
    const [created] = await db.insert(schema.users).values({ appleSub: `backup-test-${stamp}`, username: handle, email: `${handle}@example.invalid`, name: "Backup Test" }).returning({ id: schema.users.id });
    userId = created.id;
    actor.userId = userId;
    const [blog] = await db.insert(schema.blogs).values({ handle, name: "Backup Test", ownerId: userId }).returning({ id: schema.blogs.id });
    blogId = blog.id;
    await store.ensureWorkspaceFolders(blogId);
    const folders = await store.getFolders(handle);
    const blogFolder = folders.find((folder) => folder.path === "blog")!;
    const notes = folders.find((folder) => folder.mode === "notes")!;
    const first = await store.createDraftInFolder(handle, blogFolder.id, { initial: { type: "article", title: "First post", body: "Hello **world**." } });
    const second = await store.createDraftInFolder(handle, notes.id, { initial: { type: "note", title: "A note", body: "Remember this." } });
    firstId = first.id!;
    secondId = second.id!;
    await store.saveGithubInstallation({ blogId, installationId: 77, accountLogin: "octo", accountType: "User", repositorySelection: "all", connectedByLogin: "octo", actor });
  });

  afterAll(async () => {
    if (!db || !blogId) return;
    await db.delete(schema.githubInstallations).where(eq(schema.githubInstallations.blogId, blogId));
    await db.delete(schema.posts).where(eq(schema.posts.blogId, blogId));
    await db.delete(schema.folders).where(eq(schema.folders.blogId, blogId));
    await db.delete(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, userId));
    await db.delete(schema.actionAudit).where(sql`${schema.actionAudit.targetId} = ${blogId}`);
    await db.delete(schema.blogs).where(eq(schema.blogs.id, blogId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("BK-01: settings choose the repository and schedule, and refuse junk", async () => {
    await expect(backup.setBackupSettings({ blogId, repository: "not a repo", branch: null, schedule: "daily", actor, fetcher: github.fetcher })).rejects.toThrow("owner/name");
    const exposed = fakeGithub({ public: true });
    await expect(backup.setBackupSettings({ blogId, repository: "octo/backup", branch: null, schedule: "daily", actor, fetcher: exposed.fetcher })).rejects.toThrow("public");
    const record = await backup.setBackupSettings({ blogId, repository: "octo/backup", branch: null, schedule: "daily", actor, fetcher: github.fetcher });
    expect(record.backupRepository).toBe("octo/backup");
    expect(record.backupSchedule).toBe("daily");
    expect(backup.backupDue(record)).toBe(true);
  });

  it("BK-02: a run packs every authored item, validated, and commits with the installation token", async () => {
    const report = await backup.runBackup({ handle, blogId, actor, fetcher: github.fetcher });
    expect(report.reason).toBeUndefined();
    expect(report.ran).toBe(true);
    expect(report.documents).toBe(2);
    expect(report.commit).toBeTruthy();
    const manifest = backup.parseBackupManifest(github.fileText(`workspaces/${handle}/manifest.json`)!);
    expect(manifest.documents.map((document) => document.id).sort()).toEqual([firstId, secondId].sort());
    const record = (await store.getGithubInstallation(blogId))!;
    expect(record.backupLastStatus).toBe("ok");
    expect(record.backupLastCommit).toBe(report.commit);
    expect(backup.backupDue(record)).toBe(false);
    const again = await backup.runBackup({ handle, blogId, actor, fetcher: github.fetcher });
    expect(again.commit).toBeNull();
    expect((await store.getGithubInstallation(blogId))!.backupLastStatus).toBe("unchanged");
  });

  it("BK-03: a document that fails the schema aborts the run and nothing lands", async () => {
    // Postgres itself refuses an invalid document, so the only way to see one
    // is a validator that says no: the same module, mocked for one fresh copy.
    const before = github.commitCount();
    vi.resetModules();
    vi.doMock("@/lib/documents/model", async () => {
      const real = await vi.importActual<typeof import("@/lib/documents/model")>("@/lib/documents/model");
      return { ...real, validateDocumentSnapshot: () => { throw new Error("nope: content.title must be a string"); } };
    });
    try {
      const strict = await import("@/lib/github/backup.server");
      const report = await strict.runBackup({ handle, blogId, actor, fetcher: github.fetcher });
      expect(report.ran).toBe(false);
      expect(report.reason).toMatch(/does not pass the document schema/);
      expect(github.commitCount()).toBe(before);
      expect((await store.getGithubInstallation(blogId))!.backupLastStatus).toBe("failed");
    } finally {
      vi.doUnmock("@/lib/documents/model");
      vi.resetModules();
    }
  });

  it("BK-03b: a scheduled run is claimed once, even when two heartbeats race", async () => {
    const before = github.commitCount();
    const then = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const [first, second] = await Promise.all([
      backup.runBackupIfDue({ handle, blogId, actor, fetcher: github.fetcher, now: then }),
      backup.runBackupIfDue({ handle, blogId, actor, fetcher: github.fetcher, now: then }),
    ]);
    expect([first.reason, second.reason].filter((reason) => reason === "not due")).toHaveLength(1);
    expect(github.commitCount()).toBe(before);
  });

  it("BK-04: restore imports what the repository has and the workspace lost, and leaves the rest alone", async () => {
    await store.deletePost(handle, secondId);
    const report = await backup.restoreBackup({ handle, blogId, actor, fetcher: github.fetcher });
    expect(report).toMatchObject({ considered: 2, restored: 1, skipped: 1, failed: 0 });
    const posts = await store.getWorkspacePoolPosts(handle);
    const restored = posts.find((post) => post.title === "A note");
    expect(restored).toBeTruthy();
    expect(restored!.id).not.toBe(secondId);
    expect(restored!.type).toBe("note");
    expect(restored!.status).toBe("draft");
    expect(restored!.body).toContain("Remember this.");
  });
});
