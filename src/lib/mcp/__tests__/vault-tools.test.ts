import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
const mock = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), identity: vi.fn(), grants: vi.fn(), user: vi.fn(), owner: vi.fn() }));
vi.mock("@/lib/store", () => ({ getUserIdBySub: mock.user, getOwnedBlog: async () => ({ handle: "owner", name: "Files" }), getBlog: async () => ({ handle: "owner", name: "Files" }), getBlogEditRecord: mock.owner, listVaultTextpacks: mock.list, readVaultTextpack: mock.read, readVaultTextpackIdentity: mock.identity }));
vi.mock("@/lib/vault/grants", () => ({ activeVaultGrants: mock.grants, roleForVaultItem: (grants: { id: string }[], id: string) => grants.some((g) => g.id === id) ? "viewer" : null }));
import { executeVaultReadTool } from "../vault-tools";
const id = "11111111-1111-4111-8111-111111111111", secret = "22222222-2222-4222-8222-222222222222";
const auth = { token: "test", clientId: "test", scopes: ["read"], extra: { sub: "subject" } };
const result = (value: Awaited<ReturnType<typeof executeVaultReadTool>>) => JSON.parse(value.content[0].type === "text" ? value.content[0].text : "{}");
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("TEXTTEXT_VAULT_ROOT", "/isolated");
  mock.user.mockResolvedValue("owner"); mock.owner.mockResolvedValue({ id: "workspace", ownerId: "owner" }); mock.grants.mockResolvedValue([]);
  mock.list.mockResolvedValue({ items: [{ itemId: id, relativePath: "Notes/Note.textpack", revision: "hash" }, { itemId: secret, relativePath: "Private/Secret.textpack", revision: "hash" }], problems: [] });
  mock.identity.mockImplementation(async ({ itemId }) => ({ itemId, relativePath: itemId === id ? "Notes/Note.textpack" : "Private/Secret.textpack", revision: "hash" }));
  mock.read.mockImplementation(async ({ itemId }) => {
    const document = emptyDocumentSnapshot(); document.content.title = itemId === id ? "Real file" : "Private"; document.content.body = "File body needle";
    return { relativePath: itemId === id ? "Notes/Note.textpack" : "Private/Secret.textpack", revision: "hash", bytes: buildTextpack("Note", { document, markdown: `---\ntextTextId: ${itemId}\n---\n\nFile body needle` }) };
  });
});
describe("canonical file MCP read adapter", () => {
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
    expect(mock.read).toHaveBeenCalledTimes(1);
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
  it("fails closed with missing storage, revoked access or unsupported mutation", async () => {
    expect((await executeVaultReadTool("create_item", {}, { ...auth, scopes: ["sync"] })).isError).toBe(true);
    mock.user.mockResolvedValue("guest");
    expect((await executeVaultReadTool("list_items", {}, auth)).isError).toBe(true);
    vi.stubEnv("TEXTTEXT_VAULT_ROOT", "");
    expect((await executeVaultReadTool("list_items", {}, auth)).isError).toBe(true);
    expect(mock.list).not.toHaveBeenCalled();
  });
});
