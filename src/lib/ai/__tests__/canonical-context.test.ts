import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { createSelectionEnvelope, validateSelectionSource } from "../selection-envelope";
const run = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mcp/tools", () => ({ runWorkspaceToolForSession: run }));
vi.mock("@/lib/store", () => ({ getPostById: () => { throw new Error("Legacy content read forbidden"); }, getAccessibleRecentPosts: () => { throw new Error("Legacy index forbidden"); } }));
import { canonicalContextItem, canonicalContextIndex } from "../canonical-context.server";
const actor = { sub: "subject", userId: "user", handle: "workspace" };
beforeEach(() => run.mockReset());
describe("canonical assistant context", () => {
  it("reads canonical document/hash through the trusted actor boundary", async () => {
    const document = emptyDocumentSnapshot(); document.content.title = "File only"; document.content.body = "Saved passage";
    run.mockResolvedValue({ structuredContent: { item: { id: "file-id", hash: "a".repeat(64), document } } });
    const item = await canonicalContextItem(actor, "file-id");
    expect(item).toMatchObject({ title: "File only", body: "Saved passage", revision: "a".repeat(64) });
    expect(run).toHaveBeenCalledWith("read_item", { id: "file-id" }, actor);
    const envelope = await createSelectionEnvelope("file-id", item!, { field: "body", start: 0, end: 5, text: "Saved" });
    await expect(validateSelectionSource(envelope!, "file-id", item!)).resolves.toBeUndefined();
    await expect(validateSelectionSource(envelope!, "file-id", { ...item!, revision: "b".repeat(64) })).rejects.toThrow("changed");
  });
  it("denied/missing canonical content never falls back to SQL", async () => {
    run.mockResolvedValue({ isError: true, structuredContent: { item: { id: "legacy-id" } } });
    expect(await canonicalContextItem(actor, "legacy-id")).toBeNull();
    await expect(canonicalContextIndex(actor)).rejects.toThrow("unavailable");
  });
  it("bounds the canonical index and preserves exact folder paths", async () => {
    run.mockResolvedValue({ structuredContent: { items: [{ id: "file-id", path: "My Notes/Test.textpack", title: "File", excerpt: "Text" }] } });
    expect(await canonicalContextIndex(actor, "My Notes")).toEqual([{ folderPath: "My Notes", post: { id: "file-id", slug: "file-id", title: "File", excerpt: "Text" } }]);
    expect(run).toHaveBeenCalledWith("list_items", { limit: 12, folder_path: "My Notes" }, actor);
  });
});
