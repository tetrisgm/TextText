import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import {
  readVaultCollaboration, readVaultPresence, joinVaultPresence, updateVaultPresence,
  leaveVaultPresence, writeVaultTextpack, deleteVaultTextpack,
  VAULT_PRESENCE_STALE_MS, VaultCollaborationEpochError, VaultPresenceSessionError,
} from "./server-store";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function pack(body: string) {
  const document = emptyDocumentSnapshot(); document.content.body = body;
  return buildTextpack("Note", { document, markdown: `---\ntextTextId: item-1\n---\n\n${body}` });
}
describe("file vault human presence", () => {
  let root: string;
  const workspaceId = "workspace-1", itemId = "item-1", relativePath = "Notes/Shared.textpack";
  const location = () => ({ root, workspaceId, itemId });
  const identity = (epoch: number, clientId = "p-00000000-0000-4000-8000-000000000001") => ({
    clientId, principal: "account:user-1", epoch, awarenessClientId: 42,
    sessionExpiresAt: Date.now() + 86_400_000, userName: "Ava", color: "#3c7de0" as const, role: "editor" as const,
  });
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-vault-presence-"));
    await writeVaultTextpack({ ...location(), relativePath, operationId: "initial", baseRevision: null, bytes: pack("Hello") });
  });
  afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });

  it("joins, heartbeats, discloses bounded peers, and closes a registered session", async () => {
    const epoch = (await readVaultCollaboration(location()))!.epoch;
    const actor = identity(epoch);
    expect(await joinVaultPresence({ ...location(), ...actor })).toMatchObject({ epoch, presence: [{ clientId: actor.clientId, userName: "Ava", role: "editor", awareness: null }] });
    expect(await updateVaultPresence({ ...location(), ...actor, awareness: "AAA=" })).toMatchObject({ presence: [{ clientId: actor.clientId, awareness: "AAA=" }] });
    expect(await readVaultPresence(location())).toMatchObject({ epoch, presence: [{ clientId: actor.clientId }] });
    expect(await leaveVaultPresence({ ...location(), ...actor })).toEqual({ epoch, presence: [] });
    await expect(updateVaultPresence({ ...location(), ...actor, awareness: null })).rejects.toBeInstanceOf(VaultPresenceSessionError);
    expect(await readVaultPresence(location())).toEqual({ epoch, presence: [] });
  });

  it("requires the registered principal, awareness client and unexpired row", async () => {
    const epoch = (await readVaultCollaboration(location()))!.epoch;
    const actor = identity(epoch);
    await joinVaultPresence({ ...location(), ...actor });
    for (const mismatch of [{ principal: "account:other" }, { awarenessClientId: 5 }, { sessionExpiresAt: actor.sessionExpiresAt + 1 }]) {
      await expect(updateVaultPresence({ ...location(), ...actor, ...mismatch, awareness: null })).rejects.toBeInstanceOf(VaultPresenceSessionError);
    }
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + VAULT_PRESENCE_STALE_MS + 1);
    expect(await readVaultPresence(location())).toEqual({ epoch, presence: [] });
    await expect(updateVaultPresence({ ...location(), ...actor, awareness: null })).rejects.toBeInstanceOf(VaultPresenceSessionError);
  });

  it("fences old sessions when a file changes externally or is deleted", async () => {
    const epoch = (await readVaultCollaboration(location()))!.epoch;
    const actor = identity(epoch);
    await joinVaultPresence({ ...location(), ...actor });
    await fs.writeFile(path.join(root, workspaceId, relativePath), pack("External"));
    await expect(updateVaultPresence({ ...location(), ...actor, awareness: null })).rejects.toBeInstanceOf(VaultCollaborationEpochError);
    expect(await readVaultPresence(location())).toEqual({ epoch: epoch + 1, presence: [] });
    const next = identity(epoch + 1, "p-00000000-0000-4000-8000-000000000002");
    await joinVaultPresence({ ...location(), ...next });
    await deleteVaultTextpack({ ...location(), operationId: "delete", basePath: relativePath, baseRevision: hash(pack("External")) });
    expect(await readVaultPresence(location())).toBeNull();
    expect(await updateVaultPresence({ ...location(), ...next, awareness: null })).toBeNull();
  });

  it("rechecks authorization inside the vault lock before joining or heartbeating", async () => {
    const epoch = (await readVaultCollaboration(location()))!.epoch;
    const actor = identity(epoch);
    await expect(joinVaultPresence({ ...location(), ...actor, beforeCommit: async () => { throw new Error("Revoked"); } })).rejects.toThrow("Revoked");
    expect(await readVaultPresence(location())).toEqual({ epoch, presence: [] });
    await joinVaultPresence({ ...location(), ...actor });
    await expect(updateVaultPresence({ ...location(), ...actor, awareness: null, beforeCommit: async () => { throw new Error("Revoked"); } })).rejects.toThrow("Revoked");
    expect((await readVaultPresence(location()))?.presence[0]?.awareness).toBeNull();
  });
});
