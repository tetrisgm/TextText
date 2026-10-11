import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), pathAuth: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock("@/app/api/vault/scoped-auth", () => ({ authorizeVaultItem: mocks.auth, authorizeVaultItemAtPath: mocks.pathAuth }));
vi.mock("@/lib/store", () => ({ readVaultTextpack: mocks.read, writeVaultBinaryEntry: mocks.write,
  VaultBinaryEntryConflictError: class extends Error {}, VaultBusyError: class extends Error {} }));
import { GET, PATCH } from "./route";

const context = () => ({ params: Promise.resolve({ workspaceId: "workspace-1", itemId: "item-1" }) });
const source = () => buildTextpack("Note", { document: emptyDocumentSnapshot(),
  markdown: '---\ntextTextId: "item-1"\n---\n\nHello', files: { "assets/data.bin": new Uint8Array([1, 2, 3]) } });
const request = (body: Record<string, unknown>) => new Request("https://texttext.test/api/vault/workspace-1/items/item-1/binary", {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const body = { operationId: "operation-1", entryPath: "assets/data.bin", expectedHash: "a".repeat(64),
  expectedLifecycle: null, bytesBase64: Buffer.from([4, 5, 6]).toString("base64") };

describe("binary entry route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ root: "/tmp/test-vault", workspaceId: "workspace-1", actorUserId: "editor",
      actorType: "human", relativePath: "Notes/Note.textpack" });
    mocks.pathAuth.mockResolvedValue({ actorUserId: "editor" });
    mocks.read.mockResolvedValue({ bytes: source(), revision: "b".repeat(64), relativePath: "Notes/Note.textpack" });
    mocks.write.mockResolvedValue({ status: "written", itemId: "item-1", relativePath: "Notes/Note.textpack", revision: "c".repeat(64) });
  });
  it("authorizes before reading bytes and reauthorizes after loading them", async () => {
    mocks.auth.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect((await GET(new Request("https://texttext.test"), context())).status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
    const manifest = await GET(new Request("https://texttext.test"), context());
    expect(manifest.status).toBe(200);
    expect(await manifest.json()).toMatchObject({ entries: [{ path: "assets/data.bin", size: 3 }] });
    const entry = await GET(new Request("https://texttext.test?entry=assets%2Fdata.bin"), context());
    expect(new Uint8Array(await entry.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(entry.headers.get("Cache-Control")).toBe("no-store");
    mocks.auth.mockResolvedValueOnce({ relativePath: "Notes/Note.textpack" }).mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await GET(new Request("https://texttext.test"), context())).status).toBe(404);
  });
  it("passes exact binary CAS input and rechecks the writer before commit", async () => {
    mocks.write.mockImplementationOnce(async input => { await input.beforeCommit("Notes/Note.textpack"); return { status: "written" }; });
    expect((await PATCH(request(body), context())).status).toBe(200);
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ entryPath: "assets/data.bin",
      expectedLifecycle: null, bytes: Buffer.from([4, 5, 6]), beforeCommit: expect.any(Function) }));
    mocks.pathAuth.mockResolvedValueOnce({ actorUserId: "another-user" });
    mocks.write.mockImplementationOnce(async input => { await input.beforeCommit("Notes/Note.textpack"); });
    expect((await PATCH(request(body), context())).status).toBe(403);
    expect((await PATCH(request({ ...body, bytesBase64: "not base64" }), context())).status).toBe(400);
  });
});
