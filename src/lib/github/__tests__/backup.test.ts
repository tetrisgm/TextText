import { describe, expect, it } from "vitest";
import { BACKUP_MANIFEST_SCHEMA, backupDue, commitSnapshot, parseBackupManifest, sanitizeManifest, type BackupSnapshot } from "../backup.server";
import { buildTextpack, gitBlobSha, sha256Hex } from "../textpack";
import { fakeGithub } from "./fake-github";

function snapshot(items: Array<{ slug: string; body: string }>, handle = "demo"): BackupSnapshot {
  const files = new Map<string, Uint8Array>();
  const documents = items.map((item) => {
    const path = `workspaces/${handle}/blog/${item.slug}.textpack`;
    const bytes = buildTextpack(item.slug, { markdown: item.body, document: { schemaVersion: 1, content: { title: item.slug, body: item.body } } });
    files.set(path, bytes);
    return { id: `id-${item.slug}`, path, folderPath: "blog", slug: item.slug, type: "article", title: item.slug, status: "draft", updatedAt: null, sha256: sha256Hex(bytes), gitSha: gitBlobSha(bytes) };
  });
  return { manifest: { schema: BACKUP_MANIFEST_SCHEMA, handle, workspace: { name: "Demo" }, exportedAt: "2026-09-17T00:00:00.000Z", folders: [{ path: "blog", name: "Blog", mode: "blog" }], documents }, files };
}

describe("backupDue", () => {
  const base = { backupRepository: "octo/backup", backupLastRunAt: new Date("2026-09-17T00:00:00Z") };
  it("follows the schedule and never runs without a repository", () => {
    const now = new Date("2026-09-17T01:00:00Z");
    expect(backupDue({ ...base, backupSchedule: "off" }, now)).toBe(false);
    expect(backupDue({ ...base, backupSchedule: "hourly" }, now)).toBe(true);
    expect(backupDue({ ...base, backupSchedule: "daily" }, now)).toBe(false);
    expect(backupDue({ ...base, backupSchedule: "daily" }, new Date("2026-09-18T00:00:00Z"))).toBe(true);
    expect(backupDue({ ...base, backupSchedule: "weekly", backupLastRunAt: null }, now)).toBe(true);
    expect(backupDue({ ...base, backupSchedule: "hourly", backupRepository: null }, now)).toBe(false);
  });
});

describe("commitSnapshot", () => {
  const ctx = (github: ReturnType<typeof fakeGithub>) => ({ token: "ghs", repository: "octo/backup", branch: "main", fetcher: github.fetcher });

  it("uploads everything the first time and writes the manifest beside it", async () => {
    const github = fakeGithub();
    const result = await commitSnapshot(ctx(github), snapshot([{ slug: "a", body: "A" }, { slug: "b", body: "B" }]), "first");
    expect(result).toMatchObject({ uploaded: 2, removed: 0 });
    expect(result.commit).toBeTruthy();
    const tree = github.headTree();
    expect([...tree.keys()].sort()).toEqual(["README.md", "workspaces/demo/blog/a.textpack", "workspaces/demo/blog/b.textpack", "workspaces/demo/manifest.json"]);
    const manifest = parseBackupManifest(github.fileText("workspaces/demo/manifest.json")!);
    expect(manifest.documents.map((document) => document.slug)).toEqual(["a", "b"]);
  });

  it("commits nothing when nothing changed, and only the difference otherwise", async () => {
    const github = fakeGithub();
    await commitSnapshot(ctx(github), snapshot([{ slug: "a", body: "A" }, { slug: "b", body: "B" }]), "first");
    const commitsAfterFirst = github.commitCount();
    const same = await commitSnapshot(ctx(github), { ...snapshot([{ slug: "a", body: "A" }, { slug: "b", body: "B" }]), manifest: { ...snapshot([{ slug: "a", body: "A" }, { slug: "b", body: "B" }]).manifest, exportedAt: "2026-09-18T00:00:00.000Z" } }, "again");
    expect(same.commit).toBeNull();
    expect(github.commitCount()).toBe(commitsAfterFirst);
    const blobPosts = github.calls.filter((call) => call === "POST /repos/octo/backup/git/blobs").length;
    const changed = await commitSnapshot(ctx(github), snapshot([{ slug: "a", body: "A2" }, { slug: "c", body: "C" }]), "changed");
    expect(changed).toMatchObject({ uploaded: 2, removed: 1 });
    // Two textpacks and one manifest; b was never re-sent and a's old blob was not re-uploaded.
    expect(github.calls.filter((call) => call === "POST /repos/octo/backup/git/blobs").length - blobPosts).toBe(3);
    expect([...github.headTree().keys()].sort()).toEqual(["README.md", "workspaces/demo/blog/a.textpack", "workspaces/demo/blog/c.textpack", "workspaces/demo/manifest.json"]);
  });

  it("bootstraps an empty repository before using the git data api", async () => {
    const github = fakeGithub({ empty: true });
    const result = await commitSnapshot(ctx(github), snapshot([{ slug: "a", body: "A" }]), "first");
    expect(result.commit).toBeTruthy();
    expect(github.calls).toContain("PUT /repos/octo/backup/contents/workspaces/demo/README.md");
    expect(github.headTree().has("workspaces/demo/blog/a.textpack")).toBe(true);
  });
});

describe("the previous manifest is not trusted beyond its shape", () => {
  it("drops entries outside the workspace prefix, with odd leaves, or without a real id", () => {
    const good = snapshot([{ slug: "a", body: "A" }]).manifest;
    const poisoned = {
      ...good,
      documents: [
        ...good.documents,
        { ...good.documents[0], path: ".github/workflows/deploy.yml" },
        { ...good.documents[0], path: "workspaces/other/blog/x.textpack", folderPath: "blog" },
        { ...good.documents[0], path: "workspaces/demo/blog/../../x.textpack" },
        { ...good.documents[0], path: "workspaces/demo/blog/evil.yml" },
        { ...good.documents[0], path: "workspaces/demo/Blog Ideas/x.textpack", folderPath: "Blog Ideas" },
        { ...good.documents[0], id: "../not an id" },
      ],
    };
    const clean = sanitizeManifest(poisoned, "demo");
    expect(clean.documents.map((entry) => entry.path)).toEqual(["workspaces/demo/blog/a.textpack"]);
  });

  it("never deletes a file the workspace did not write, even when the manifest names it", async () => {
    const github = fakeGithub();
    await commitSnapshot({ token: "ghs", repository: "octo/backup", branch: "main", fetcher: github.fetcher }, snapshot([{ slug: "a", body: "A" }, { slug: "b", body: "B" }]), "first");
    // Someone with push edits the manifest to claim README.md as ours.
    const manifest = parseBackupManifest(github.fileText("workspaces/demo/manifest.json")!);
    manifest.documents.push({ ...manifest.documents[0], path: "README.md" });
    const readmeSha = github.headTree().get("README.md")!;
    const sha = (await import("../textpack")).gitBlobSha(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    github.blobs.set(sha, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    const tree = github.headTree();
    tree.set("workspaces/demo/manifest.json", sha);
    github.setHead(tree);
    await commitSnapshot({ token: "ghs", repository: "octo/backup", branch: "main", fetcher: github.fetcher }, snapshot([{ slug: "a", body: "A" }]), "second");
    expect(github.headTree().get("README.md")).toBe(readmeSha);
    expect(github.headTree().has("workspaces/demo/blog/b.textpack")).toBe(false);
  });
});
