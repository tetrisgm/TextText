import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { ensureVaultFolders, listVaultFolderViews } from "./server-store";

const access = vi.hoisted(() => ({ value: {} as Record<string, unknown>, allowed: true }));
vi.mock("@/app/api/vault/scoped-auth", () => ({
  authorizeVaultWorkspaceOrScoped: async () => access.value,
  canSeeVaultFolder: () => access.allowed,
  canSeeVaultItem: () => false,
}));
vi.mock("@/lib/store", async () => {
  const store = await import("./server-store");
  return { ...store };
});
import { GET } from "@/app/api/vault/[workspaceId]/items/route";

async function inventory(root: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  async function visit(relative: string) {
    const full = path.join(root, relative), info = await fs.lstat(full);
    if (info.isSymbolicLink()) { rows.push([relative, "link", await fs.readlink(full)]); return; }
    if (info.isDirectory()) {
      rows.push([relative, "directory"]);
      for (const name of (await fs.readdir(full)).sort()) await visit(path.join(relative, name));
    } else rows.push([relative, createHash("sha256").update(await fs.readFile(full)).digest("hex")]);
  }
  await visit(""); return rows;
}

describe("folder view reads preserve the workspace", () => {
  it("does not create typed prefixes or nested missing folders", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-folder-read-"));
    const location = { root, workspaceId: "fixture-workspace" };
    await ensureVaultFolders(location, []);
    const before = await inventory(root);
    for (const folder of ["P", "Ph", "Phase", "Phase/Missing"])
      expect(await listVaultFolderViews({ ...location, folder })).toEqual({ files: [] });
    expect(await inventory(root)).toEqual(before);
  });
  it("rejects invalid paths and symlink parents without changing either tree", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-folder-read-guards-"));
    const location = { root, workspaceId: "fixture-workspace" };
    await ensureVaultFolders(location, []);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-folder-read-outside-"));
    await fs.symlink(outside, path.join(root, location.workspaceId, "Alias"), process.platform === "win32" ? "junction" : "dir");
    const before = await inventory(root), outsideBefore = await inventory(outside);
    for (const folder of ["../outside", "/absolute", "A/../B", "A//B", "A\\B"])
      await expect(listVaultFolderViews({ ...location, folder })).rejects.toThrow();
    await expect(listVaultFolderViews({ ...location, folder: "Alias/Nested" })).rejects.toThrow();
    expect(await inventory(root)).toEqual(before);
    expect(await inventory(outside)).toEqual(outsideBefore);
  });
  it("keeps a scoped viewer's missing-folder GET read-only and refuses invisible folders", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-folder-viewer-"));
    const location = { root, workspaceId: "fixture-workspace" };
    await ensureVaultFolders(location, []);
    access.value = { ...location, actorUserId: "fixture-viewer", actorType: "human", fullAccess: false, canEditContent: false, grants: [] };
    access.allowed = true;
    const before = await inventory(root);
    const context = { params: Promise.resolve({ workspaceId: location.workspaceId }) };
    const response = await GET(new Request("https://fixture.test/items?folderViews=Visible/Missing"), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ files: [] });
    expect(await inventory(root)).toEqual(before);
    access.allowed = false;
    expect((await GET(new Request("https://fixture.test/items?folderViews=Private/Missing"), context)).status).toBe(404);
    expect(await inventory(root)).toEqual(before);
  });
});
