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

import { nativeAgentPresence } from "./agent-presence";
import { issueVaultPresenceSession, verifyVaultPresenceSession } from "./presence-session.server";

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
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });

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

  it("persists authenticated agent identity through the real signed-session lifecycle", async () => {
    vi.stubEnv("AUTH_SECRET", "test-only-native-presence-key");
    const epoch = (await readVaultCollaboration(location()))!.epoch;
    const attribution = nativeAgentPresence({ agent: { name: "Codex", taskId: "task-1" } },
      { actorUserId: "user-1", actorName: "Ava", canAttributeNativeEditor: true, canEditContent: true })!;
    const session = issueVaultPresenceSession(attribution.principal, workspaceId, itemId, epoch, 42);
    const actor = { ...identity(epoch, session.clientId), ...attribution, sessionExpiresAt: session.expiresAt };
    expect(verifyVaultPresenceSession(session.sessionCredential, actor.principal, workspaceId, itemId, actor.clientId)).toMatchObject({ principal: attribution.principal });
    expect(verifyVaultPresenceSession(session.sessionCredential, "account:user-1", workspaceId, itemId, actor.clientId)).toBeNull();
    await joinVaultPresence({ ...location(), ...actor });
    expect(await readVaultPresence(location())).toMatchObject({ presence: [{ userName: "Codex (agent) · Ava" }] });
    await updateVaultPresence({ ...location(), ...actor, awareness: "AAA=" });
    expect(await readVaultPresence(location())).toMatchObject({ presence: [{ awareness: "AAA=" }] });
    await expect(leaveVaultPresence({ ...location(), ...actor, principal: 'native-agent:["other","Codex","task-1"]' })).rejects.toBeInstanceOf(VaultPresenceSessionError);
    expect(await leaveVaultPresence({ ...location(), ...actor })).toEqual({ epoch, presence: [] });
    await joinVaultPresence({ ...location(), ...actor });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + VAULT_PRESENCE_STALE_MS + 1);
    expect(await readVaultPresence(location())).toEqual({ epoch, presence: [] });
  });

  it("rejects malformed or noncanonical agent principals in joins and leaves", async () => {
    const epoch = (await readVaultCollaboration(location()))!.epoch;
    for (const principal of ["native-agent:any", 'native-agent:{}', 'native-agent:["user","Codex"]',
      'native-agent:["","Codex","task"]', 'native-agent:["user","Codex","task", "extra"]',
      'native-agent:["user","Codex","bad/task"]', 'native-agent:[ "user","Codex","task"]']) {
      await expect(joinVaultPresence({ ...location(), ...identity(epoch), principal })).rejects.toThrow("Invalid vault presence identity");
      await expect(leaveVaultPresence({ ...location(), ...identity(epoch), principal })).rejects.toBeInstanceOf(VaultPresenceSessionError);
    }
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
