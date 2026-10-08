import { describe, expect, it } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { executeWindowsAgentTool, executeWindowsFolderAgentTool } from "./windows-agent-tools";
import { readDocument, writePayload } from "./model";
import type { VaultFile, VaultTransport } from "./bridge";

function fixture() {
  const document = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
  document.content.title = "Original"; document.content.body = "original content";
  let file: VaultFile = { ...writePayload({ path: "Notes/Original.textpack", hash: "revision", markdown: '---\ntextTextId: "stable-item"\n---\n' }, document), templateAuthoringSourceJSON: undefined };
  let writes = 0;
  const request: VaultTransport = async (method, params) => {
    if (method === "read") return file;
    if (method === "write") { writes++; file = { ...file, ...params, hash: "saved" } as VaultFile; return file; }
    throw new Error("Unexpected operation");
  };
  return { request, file: () => file, writes: () => writes };
}
describe("Windows selected-item agent tools", () => {
  it("creates only within an explicit existing folder and rejects traversal before writes", async () => {
    const calls: Record<string, unknown>[] = [];
    const request: VaultTransport = async (method, params) => {
      if (method === "list") return { root: "fixture", folders: ["Notes", "Notes/Research", "Other"], items: [] };
      if (method === "create") { calls.push(params); return { path: `${params.folder}/New.textpack`, hash: "new" }; }
      throw new Error("Unexpected access");
    };
    await expect(executeWindowsFolderAgentTool(request, "Notes", "create_file", { title: "New", body: "Keep", folder: "Other" })).rejects.toThrow("selected folder");
    await expect(executeWindowsFolderAgentTool(request, "Notes", "read_file", { path: "Notes/../Other/X.textpack" })).rejects.toThrow("selected folder");
    await executeWindowsFolderAgentTool(request, "Notes", "create_file", { title: "New", body: "Keep", folder: "Notes/Research", kind: "note" });
    expect(calls).toEqual([{ title: "New", body: "Keep", folder: "Notes/Research", kind: "note" }]);
  });
  it("searches the folder and excludes sibling and traversal results", async () => {
    const calls: Record<string, unknown>[] = [];
    const request: VaultTransport = async (method, params) => {
      if (method === "list") return { folders: ["Notes"], items: [] };
      if (method === "search") { calls.push(params); return { items: [
        { path: "Notes/A.textpack", title: "A", snippet: "match" },
        { path: "Other/B.textpack", title: "Secret", snippet: "private" },
        { path: "Notes/../Other/B.textpack", title: "Secret", snippet: "private" },
        { path: "Notes2/C.textpack", title: "Sibling", snippet: "private" },
      ], skippedCount: 1 }; }
      throw new Error("Unexpected operation");
    };
    const result = JSON.parse(await executeWindowsFolderAgentTool(request, "Notes", "search_files", { query: "match" }));
    expect(calls).toEqual([{ query: "match", folder: "Notes" }]);
    expect(result).toEqual({ items: [{ path: "Notes/A.textpack", title: "A", snippet: "match" }], truncated: false, skippedCount: 1 });
    await expect(executeWindowsFolderAgentTool(request, "Notes", "search_files", { query: "x".repeat(501) })).rejects.toThrow("500");
    expect(calls).toHaveLength(1);
  });
  it("rejects other paths, unsupported tools and stale write hashes", async () => {
    const f = fixture(); const path = f.file().path;
    await expect(executeWindowsAgentTool(f.request, path, "read_file", { path: "Notes/Other.textpack" })).rejects.toThrow("selected item");
    await expect(executeWindowsAgentTool(f.request, path, "shell", { path })).rejects.toThrow("selected item");
    await expect(executeWindowsAgentTool(f.request, path, "write_file", { path, hash: "old", markdown: "overwrite" })).rejects.toThrow("intervening edits");
    expect(f.writes()).toBe(0);
  });
  it("validates schema before writing and preserves stable identity for markdown edits", async () => {
    const f = fixture(); const path = f.file().path;
    await expect(executeWindowsAgentTool(f.request, path, "write_file", { path, hash: "revision", markdown: "body", documentJSON: '{"schemaVersion":999}' })).rejects.toThrow();
    expect(f.writes()).toBe(0);
    const markdown = f.file().markdown.replace("original content", "agent edit");
    await executeWindowsAgentTool(f.request, path, "write_file", { path, hash: "revision", markdown });
    expect(readDocument(f.file()).content.body).toBe("agent edit");
    expect(f.file().markdown).toContain('textTextId: "stable-item"');
  });
  it("template proposals validate without mutating the document", async () => {
    const f = fixture(); const file = f.file();
    const proposal = JSON.parse(await executeWindowsAgentTool(f.request, file.path, "propose_template", { path: file.path, hash: file.hash, templateJSON: file.templateJSON }));
    expect(proposal).toMatchObject({ path: file.path, hash: file.hash }); expect(f.writes()).toBe(0);
    await expect(executeWindowsAgentTool(f.request, file.path, "propose_template", { path: file.path, hash: file.hash, templateJSON: '{"html":"<script>bad()</script>"}' })).rejects.toThrow();
    expect(f.writes()).toBe(0);
  });
});
