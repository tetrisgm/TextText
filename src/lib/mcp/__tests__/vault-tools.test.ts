import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
const mock = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), identity: vi.fn(), grants: vi.fn(), user: vi.fn(), owner: vi.fn(), preview: vi.fn(), search: vi.fn() }));
vi.mock("@/lib/store", () => ({ getUserIdBySub: mock.user, getOwnedBlog: async () => ({ handle: "owner", name: "Files" }), getBlog: async () => ({ handle: "owner", name: "Files" }), getBlogEditRecord: mock.owner, listVaultTextpacks: mock.list, readVaultTextpack: mock.read, readVaultTextpackIdentity: mock.identity, readVaultPreview: mock.preview, searchVaultTextpacks: mock.search }));
vi.mock("@/lib/vault/grants", () => ({ activeVaultGrants: mock.grants, roleForVaultFolder: () => null, roleForVaultItem: (grants: { id: string }[], id: string) => grants.some((g) => g.id === id) ? "viewer" : null }));
vi.mock("@/auth", () => ({ auth: vi.fn(), isAuthConfigured: () => false }));
import { executeVaultReadTool } from "../vault-tools";
const id = "11111111-1111-4111-8111-111111111111", secret = "22222222-2222-4222-8222-222222222222";
const auth = { token: "test", clientId: "test", scopes: ["read"], extra: { sub: "subject" } };
const result = (value: Awaited<ReturnType<typeof executeVaultReadTool>>) => JSON.parse(value.content[0].type === "text" ? value.content[0].text : "{}");
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("TEXTTEXT_VAULT_ROOT", "/isolated");
  mock.user.mockResolvedValue("owner"); mock.owner.mockResolvedValue({ id: "workspace", ownerId: "owner" }); mock.grants.mockResolvedValue([]);
  mock.list.mockResolvedValue({ items: [{ itemId: id, relativePath: "Notes/Note.textpack", revision: "hash" }, { itemId: secret, relativePath: "Private/Secret.textpack", revision: "hash" }], problems: [], folders: ["Notes", "Private"] });
  mock.identity.mockImplementation(async ({ itemId }) => ({ itemId, relativePath: itemId === id ? "Notes/Note.textpack" : "Private/Secret.textpack", revision: "hash" }));
  mock.preview.mockResolvedValue({ title: "Real file", excerpt: "File body needle" });
  mock.search.mockImplementation(async (_location, entries) => ({ items: entries.map((entry: { relativePath: string }) => ({ path: entry.relativePath, title: "Real file", snippet: "needle" })), truncated: false }));
  mock.read.mockImplementation(async ({ itemId }) => {
    const document = emptyDocumentSnapshot(); document.content.title = itemId === id ? "Real file" : "Private"; document.content.body = "File body needle";
    return { relativePath: itemId === id ? "Notes/Note.textpack" : "Private/Secret.textpack", revision: "hash", bytes: buildTextpack("Note", { document, markdown: `---\ntextTextId: ${itemId}\n---\n\nFile body needle` }) };
  });
});
describe("canonical file MCP read adapter", () => {
  it("dispatches the public executor and resource-style call to files, with a narrowed catalog", async () => {
    const { executeMcpTool, runWorkspaceToolForAuth } = await import("../tools");
    const { listTools, callTool } = await import("../registry");
    expect(result(await executeMcpTool("read_item", { id }, { authInfo: auth })).item.id).toBe(id);
    expect(result(await runWorkspaceToolForAuth("list_folders", {}, { authInfo: auth })).folders.map((folder: { path: string }) => folder.path)).toEqual(["Notes", "Private"]);
    expect(listTools().map((tool) => tool.name)).toEqual(["get_workspace", "list_folders", "list_items", "read_item", "search", "create_item", "update_item", "append_to_item"]);
    expect((await callTool("delete_item", { id }, { authInfo: { ...auth, scopes: ["sync"] } })).isError).toBe(true);
    const update = listTools().find((tool) => tool.name === "update_item")!;
    expect(update.inputSchema.properties).not.toHaveProperty("markdown");
  });
  it("reads actual packs and searches body; no SQL post source exists", async () => {
    expect(result(await executeVaultReadTool("read_item", { id }, auth)).item).toMatchObject({ id, title: "Real file", body: "File body needle" });
    expect(result(await executeVaultReadTool("search", { query: "needle" }, auth)).items).toHaveLength(2);
    expect(result(await executeVaultReadTool("list_items", { folder_path: "Notes" }, auth)).items).toHaveLength(1);
  });
  it("filters file grants before opening packs and does not leak inaccessible names", async () => {
    mock.user.mockResolvedValue("guest"); mock.grants.mockResolvedValue([{ id }]);
    const response = await executeVaultReadTool("list_items", {}, auth);
    expect(result(response).items).toHaveLength(1);
    expect(JSON.stringify(response)).not.toContain("Secret");
    expect(mock.preview).toHaveBeenCalledTimes(1);
    expect((await executeVaultReadTool("read_item", { id: secret }, auth)).isError).toBe(true);
  });
  it("restricts item tokens before enumeration and rejects malformed mixed scopes", async () => {
    const token = { ...auth, scopes: [`item:${id}:read`] };
    expect((await executeVaultReadTool("list_items", {}, token)).isError).toBe(true);
    expect(mock.list).not.toHaveBeenCalled();
    expect((await executeVaultReadTool("read_item", { id: secret }, token)).isError).toBe(true);
    expect((await executeVaultReadTool("read_item", { id }, { ...token, scopes: [...token.scopes, "sync"] })).isError).toBe(true);
    expect(result(await executeVaultReadTool("read_item", { id }, token)).item.id).toBe(id);
  });
  it("rechecks revoked grants after reading metadata and uses shared search", async () => {
    mock.user.mockResolvedValue("guest"); mock.grants.mockResolvedValue([{ id }]);
    mock.preview.mockImplementation(async () => { mock.grants.mockResolvedValue([]); return { title: "secret", excerpt: "secret" }; });
    expect(result(await executeVaultReadTool("list_items", {}, auth)).items).toEqual([]);
    mock.user.mockResolvedValue("owner");
    await executeVaultReadTool("search", { query: "needle" }, auth);
    expect(mock.search).toHaveBeenCalled();
    expect(mock.read).not.toHaveBeenCalled();
  });
  it("handles root-level item folder without truncating its filename", async () => {
    mock.list.mockResolvedValue({ items: [{ itemId: id, relativePath: "Note.textpack", revision: "hash" }], problems: [], folders: ["Notes", "Private"] });
    mock.identity.mockResolvedValue({ itemId: id, relativePath: "Note.textpack", revision: "hash" });
    expect(result(await executeVaultReadTool("list_items", { folder_path: "" }, auth)).items).toHaveLength(1);
  });
  it("fails closed with missing storage, revoked access or unsupported mutation", async () => {
    expect((await executeVaultReadTool("delete_item", {}, { ...auth, scopes: ["sync"] })).isError).toBe(true);
    mock.user.mockResolvedValue("guest");
    expect((await executeVaultReadTool("list_items", {}, auth)).isError).toBe(true);
    vi.stubEnv("TEXTTEXT_VAULT_ROOT", "");
    expect((await executeVaultReadTool("list_items", {}, auth)).isError).toBe(true);
    expect(mock.list).not.toHaveBeenCalled();
  });
});
