import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Against local Postgres only (npm run test:reading:db). Scratch user and
// workspace, removed in afterAll.
const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("github installations against Postgres", () => {
  let db: typeof import("@/lib/db/client").db;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  let userId = "";
  let blogId = "";

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only local Postgres is allowed");
    ({ db } = await import("@/lib/db/client"));
    schema = await import("@/lib/db/schema");
    store = await import("@/lib/store");
    if (!db) throw new Error("no db");
    const stamp = `${Date.now().toString(36)}-${process.pid}`;
    const [created] = await db.insert(schema.users).values({ appleSub: `github-test-${stamp}`, username: `github-test-${stamp}`, email: `github-${stamp}@example.invalid`, name: "GitHub Test" }).returning({ id: schema.users.id });
    userId = created.id;
    const [blog] = await db.insert(schema.blogs).values({ handle: `github-test-${stamp}`, name: "GitHub Test", ownerId: userId }).returning({ id: schema.blogs.id });
    blogId = blog.id;
  });

  afterAll(async () => {
    if (!db || !blogId) return;
    await db.delete(schema.githubInstallations).where(eq(schema.githubInstallations.blogId, blogId));
    await db.delete(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, userId));
    await db.delete(schema.blogs).where(eq(schema.blogs.id, blogId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("GH-01: connecting stores one installation per workspace and audits it", async () => {
    const actor = { userId, actorType: "human" as const };
    expect(await store.getGithubInstallation(blogId)).toBeNull();
    const saved = await store.saveGithubInstallation({ blogId, installationId: 1001, accountLogin: "octo", accountType: "User", repositorySelection: "selected", connectedByLogin: "octo", actor });
    expect(saved.installationId).toBe(1001);
    expect(saved.backupSchedule).toBe("off");
    const audits = await db!.select({ name: schema.actionAudit.actionName, output: schema.actionAudit.outputSummary }).from(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, userId));
    expect(audits).toEqual([{ name: "github.connect_installation", output: "connected" }]);
  });

  it("GH-02: reconnecting the same installation keeps the backup target; a different one drops it", async () => {
    const actor = { userId, actorType: "human" as const };
    await db!.update(schema.githubInstallations).set({ backupRepository: "octo/backup", backupSchedule: "daily" }).where(eq(schema.githubInstallations.blogId, blogId));
    const same = await store.saveGithubInstallation({ blogId, installationId: 1001, accountLogin: "octo", accountType: "User", repositorySelection: "all", connectedByLogin: "octo", actor });
    expect(same.backupRepository).toBe("octo/backup");
    expect(same.backupSchedule).toBe("daily");
    expect(same.repositorySelection).toBe("all");
    const other = await store.saveGithubInstallation({ blogId, installationId: 2002, accountLogin: "acme", accountType: "Organization", repositorySelection: "selected", connectedByLogin: "octo", actor });
    expect(other.installationId).toBe(2002);
    expect(other.backupRepository).toBeNull();
    expect(other.backupSchedule).toBe("off");
    const rows = await db!.select().from(schema.githubInstallations).where(eq(schema.githubInstallations.blogId, blogId));
    expect(rows).toHaveLength(1);
  });

  it("GH-03: forgetting removes the row, audits, and is idempotent", async () => {
    const actor = { userId, actorType: "human" as const };
    expect(await store.forgetGithubInstallation(blogId, actor)).toBe(true);
    expect(await store.getGithubInstallation(blogId)).toBeNull();
    expect(await store.forgetGithubInstallation(blogId, actor)).toBe(false);
    const audits = await db!.select({ name: schema.actionAudit.actionName }).from(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, userId));
    expect(audits.map((row) => row.name)).toEqual(["github.connect_installation", "github.connect_installation", "github.connect_installation", "github.disconnect_installation"]);
  });
});
