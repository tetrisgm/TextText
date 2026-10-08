import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
const mock = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), identity: vi.fn(), grants: vi.fn(), user: vi.fn(), owner: vi.fn(), preview: vi.fn(), search: vi.fn(), comments: vi.fn(), commentWrite: vi.fn(), move: vi.fn(), remove: vi.fn(), trash: vi.fn(), restore: vi.fn(), template: vi.fn(), mutate: vi.fn() }));
vi.mock("@/lib/store", () => ({ getUserIdBySub: mock.user, getOwnedBlog: async () => ({ handle: "owner", name: "Files" }), getBlog: async () => ({ handle: "owner", name: "Files" }), getBlogEditRecord: mock.owner, listVaultTextpacks: mock.list, readVaultTextpack: mock.read, readVaultTextpackIdentity: mock.identity, readVaultPreview: mock.preview, searchVaultTextpacks: mock.search, listVaultItemComments: mock.comments, mutateVaultItemComments: mock.commentWrite, moveVaultTextpack: mock.move, deleteVaultTextpack: mock.remove, listVaultTrash: mock.trash, restoreVaultTextpack: mock.restore, readVaultTemplate: mock.template, mutateVaultDocument: mock.mutate }));
vi.mock("@/lib/vault/grants", () => ({ activeVaultGrants: mock.grants, roleForVaultFolder: (grants: { folder?: string; role?: string }[], folder: string) => grants.find(g => g.folder === folder)?.role ?? null, roleForVaultItem: (grants: { id: string; role?: string }[], id: string) => { const grant = grants.find(g => g.id === id); return grant ? grant.role ?? "viewer" : null; } }));
vi.mock("../vault-agent-presence", () => ({ withVaultAgentPresence: async (context: {authorize: (path: string) => Promise<void>}, action: () => Promise<unknown>) => { await context.authorize("Notes/Note.textpack"); return action(); } }));
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
  mock.trash.mockResolvedValue({ items: [{ itemId: id, relativePath: "Notes/Note.textpack", revision: "a".repeat(64) }], truncated: false });
  mock.restore.mockImplementation(async input => { await input.beforeCommit(input.basePath); return { status: "restored", itemId: input.itemId, relativePath: input.relativePath, revision: "b".repeat(64) }; });
  mock.move.mockImplementation(async input => { await input.beforeCommit(input.basePath); return { status: "moved", itemId: input.itemId, relativePath: input.relativePath, revision: input.baseRevision }; });
  mock.remove.mockImplementation(async input => { await input.beforeCommit(input.basePath); return { status: "deleted", itemId: input.itemId, relativePath: input.basePath, revision: input.baseRevision }; });
  mock.comments.mockResolvedValue({ comments: [], nextCursor: null, revision: "hash", relativePath: "Notes/Note.textpack" });
  mock.commentWrite.mockImplementation(async (input) => { await input.beforeCommit("Notes/Note.textpack"); return { status: "written", commentId: input.operationId }; });
  mock.preview.mockResolvedValue({ sourceBytes: 100, document: emptyDocumentSnapshot(), title: "Real file", excerpt: "File body needle" });
  mock.search.mockImplementation(async (_location, entries) => ({ items: entries.map((entry: { relativePath: string }) => ({ path: entry.relativePath, title: "Real file", snippet: "needle" })), truncated: false }));
  mock.read.mockImplementation(async ({ itemId }) => {
    const document = emptyDocumentSnapshot(); document.content.title = itemId === id ? "Real file" : "Private"; document.content.body = "File body needle";
    return { relativePath: itemId === id ? "Notes/Note.textpack" : "Private/Secret.textpack", revision: "hash", bytes: buildTextpack("Note", { document, markdown: `---\ntextTextId: ${itemId}\n---\n\nFile body needle` }) };
  });
});
describe("canonical file MCP read adapter", () => {
  it("narrows owner reads, search and folders to the server-issued task folder", async () => {
    const scoped = { ...auth, extra: { ...auth.extra, folderAgentPath: "Notes" } };
    expect(result(await executeVaultReadTool("list_folders", {}, scoped)).folders.map((folder: {path: string}) => folder.path)).toEqual(["Notes"]);
    expect(result(await executeVaultReadTool("search", {query: "needle"}, scoped)).items.map((item: {id: string}) => item.id)).toEqual([id]);
    expect((await executeVaultReadTool("read_item", {id: secret}, scoped)).isError).toBe(true);
    expect((await executeVaultReadTool("get_workspace", {}, scoped)).isError).toBe(true);
    mock.identity.mockResolvedValue({itemId: id, relativePath: "Private/Moved.textpack", revision: "hash"});
    expect((await executeVaultReadTool("read_item", {id}, scoped)).isError).toBe(true);
  });
  it("rejects malformed folder boundaries before accessing files", async () => {
    for (const folderAgentPath of ["../Notes", "Notes/", "Notes\\Other", null]) {
      expect((await executeVaultReadTool("read_item", {id}, { ...auth, extra: { ...auth.extra, folderAgentPath } })).isError).toBe(true);
    }
    expect(mock.read).not.toHaveBeenCalled();
  });

  it("dispatches the public executor and resource-style call to files, with a narrowed catalog", async () => {
    const { executeMcpTool, runWorkspaceToolForAuth } = await import("../tools");
    const { listTools, callTool } = await import("../registry");
    expect(result(await executeMcpTool("read_item", { id }, { authInfo: auth })).item.id).toBe(id);
    expect(result(await runWorkspaceToolForAuth("list_folders", {}, { authInfo: auth })).folders.map((folder: { path: string }) => folder.path)).toEqual(["Notes", "Private"]);
    expect(listTools().map((tool) => tool.name)).toEqual(["get_workspace", "list_folders", "create_folder", "list_items", "read_item", "search", "create_item", "update_item", "append_to_item", "add_item_asset", "remove_item_asset", "list_comments", "add_comment", "set_comment_resolved", "move_item", "delete_item", "list_trash", "restore_item", "list_document_templates", "set_item_template", "create_item_type", "save_item_as_look", "update_item_type", "remix_item_type", "retire_document_template", "set_folder_template", "move_folder_tree"]);
    expect((await callTool("delete_item", { id }, { authInfo: { ...auth, scopes: ["sync"] } })).isError).toBe(true);
    const update = listTools().find((tool) => tool.name === "update_item")!;
    expect(update.inputSchema.properties).not.toHaveProperty("markdown");
  });
  it("dispatches file comments for readers and editors with a narrowed anchor-free catalog", async () => {
    const { executeMcpTool } = await import("../tools");
    expect(result(await executeMcpTool("list_comments", { id }, { authInfo: auth })).comments).toEqual([]);
    expect((await executeMcpTool("add_comment", { id, body: "hello" }, { authInfo: auth })).isError).toBe(true);
    const editor = { ...auth, scopes: ["sync"], extra: { ...auth.extra, userId: "owner", connectionId: "connection" } };
    const added = await executeMcpTool("add_comment", { id, body: "hello", idempotency_key: "event" }, { authInfo: editor });
    expect(added.isError).not.toBe(true);
    expect(mock.commentWrite).toHaveBeenCalledTimes(1);
    const { listTools } = await import("../registry");
    const schema = listTools().find((tool) => tool.name === "add_comment")!.inputSchema;
    expect(schema.properties).not.toHaveProperty("anchor_quote");
    expect(schema.properties?.body).toMatchObject({ maxLength: 4000 });
  });
  it("requires destination folder grants for public moves and freshly checks revocation", async () => {
    const { executeMcpTool } = await import("../tools");
    mock.user.mockResolvedValue("guest");
    mock.grants.mockResolvedValue([{ id, role: "editor" }]);
    const editor = { ...auth, scopes: ["sync"], extra: { ...auth.extra, userId: "guest", connectionId: "connection" } };
    const input = { id, path: "Notes/Note.textpack", if_match_hash: "a".repeat(64), folder_path: "Research", idempotency_key: "move" };
    expect((await executeMcpTool("move_item", input, { authInfo: editor })).isError).toBe(true);
    expect(mock.move).not.toHaveBeenCalled();
    mock.grants.mockResolvedValue([{ id, role: "editor" }, { folder: "Research", role: "editor" }]);
    const moved = await executeMcpTool("move_item", input, { authInfo: editor });
    expect(moved.isError, JSON.stringify(moved)).not.toBe(true);
    mock.move.mockImplementationOnce(async input => { mock.grants.mockResolvedValue([]); await input.beforeCommit(input.basePath); throw new Error("unreachable"); });
    expect((await executeMcpTool("move_item", input, { authInfo: editor })).isError).toBe(true);
    expect((await executeMcpTool("delete_item", { id, path: input.path, if_match_hash: input.if_match_hash, idempotency_key: "delete" }, { authInfo: { ...editor, scopes: [`item:${id}:edit`] } })).isError).toBe(true);
  });
  it("dispatches file template listing/apply and fences read-only callers", async () => {
    const { executeMcpTool } = await import("../tools");
    const list = await executeMcpTool("list_document_templates", {}, { authInfo: auth });
    expect(list.isError, JSON.stringify(list)).not.toBe(true);
    expect(result(list).templates.some((entry: { definition: { id: string } }) => entry.definition.id === "texttext.note")).toBe(true);
    const input = { id, template_id: "texttext.note", if_match_hash: "a".repeat(64), idempotency_key: "template-once" };
    expect((await executeMcpTool("set_item_template", input, { authInfo: auth })).isError).toBe(true);
    expect(mock.mutate).not.toHaveBeenCalled();
    mock.mutate.mockImplementation(async input => { await input.beforeCommit("Notes/Note.textpack"); return { status: "written", itemId: input.itemId }; });
    const applied = await executeMcpTool("set_item_template", input, { authInfo: { ...auth, scopes: ["sync"], extra: { ...auth.extra, userId: "owner", connectionId: "connection" } } });
    expect(applied.isError, JSON.stringify(applied)).not.toBe(true);
    expect(mock.mutate.mock.calls[0][0]).toMatchObject({ expectedRevision: input.if_match_hash, presentation: { definition: { id: "texttext.note" } } });
  });
  it("lists current authorized tombstones and restores through the public catalog", async () => {
    const { executeMcpTool } = await import("../tools");
    const trash = await executeMcpTool("list_trash", {}, { authInfo: auth });
    expect(result(trash).items).toEqual([{ id, path: "Notes/Note.textpack", hash: "a".repeat(64) }]);
    const response = await executeMcpTool("restore_item", { id, path: "Notes/Note.textpack", if_match_hash: "a".repeat(64), idempotency_key: "restore" }, { authInfo: { ...auth, scopes: ["sync"], extra: { ...auth.extra, userId: "owner", connectionId: "connection" } } });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expect(result(response).status).toBe("restored");
    mock.user.mockResolvedValue("guest"); mock.grants.mockResolvedValue([{ id: secret }]);
    expect(result(await executeMcpTool("list_trash", {}, { authInfo: auth })).items).toEqual([]);
  });
  it("attributes native human comments without the assistant connection label", async () => {
    const response = await executeVaultReadTool("add_comment", { id, body: "Human note" }, { ...auth, scopes: ["sync"], extra: { ...auth.extra, actorType: "human", connectionName: "Assistant" } });
    expect(response.isError).not.toBe(true);
    expect(mock.commentWrite.mock.calls[0][0].actor).toMatchObject({ type: "human", name: "TextText user" });
  });
  it("denies comment writes for file viewers and rechecks revocation after reading", async () => {
    mock.user.mockResolvedValue("guest"); mock.grants.mockResolvedValue([{ id }]);
    const editor = { ...auth, scopes: ["sync"], extra: { ...auth.extra, userId: "guest", connectionId: "connection" } };
    expect((await executeVaultReadTool("add_comment", { id, body: "hello" }, editor)).isError).toBe(true);
    expect(mock.commentWrite).not.toHaveBeenCalled();
    mock.comments.mockImplementation(async () => { mock.grants.mockResolvedValue([]); return { comments: [{ body: "private" }], nextCursor: null, revision: "hash", relativePath: "Notes/Note.textpack" }; });
    const response = await executeVaultReadTool("list_comments", { id }, auth);
    expect(response.isError).toBe(true); expect(JSON.stringify(response)).not.toContain("private");
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
    mock.preview.mockImplementation(async () => { mock.grants.mockResolvedValue([]); return { sourceBytes: 100, document: emptyDocumentSnapshot(), title: "secret", excerpt: "secret" }; });
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
