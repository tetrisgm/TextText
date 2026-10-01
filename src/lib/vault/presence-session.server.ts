import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";

const PURPOSE = "vault-presence-v1";
export const VAULT_PRESENCE_SESSION_MS = 24 * 60 * 60 * 1000;

export type VaultPresenceSession = {
  purpose: typeof PURPOSE;
  principal: string;
  workspaceId: string;
  itemId: string;
  epoch: number;
  clientId: string;
  awarenessClientId: number;
  expiresAt: number;
};

export function issueVaultPresenceSession(
  principal: string, workspaceId: string, itemId: string, epoch: number, awarenessClientId: number,
) {
  if (!principal || !Number.isSafeInteger(epoch) || epoch < 1 ||
      !Number.isSafeInteger(awarenessClientId) || awarenessClientId < 0 || awarenessClientId > 0xffffffff) {
    throw new Error("Invalid vault presence session");
  }
  const session: VaultPresenceSession = {
    purpose: PURPOSE, principal, workspaceId, itemId, epoch,
    clientId: `p-${randomUUID()}`, awarenessClientId,
    expiresAt: Date.now() + VAULT_PRESENCE_SESSION_MS,
  };
  return { clientId: session.clientId, sessionCredential: encryptSecret(JSON.stringify(session)), expiresAt: session.expiresAt };
}

export function verifyVaultPresenceSession(
  credential: unknown, principal: string, workspaceId: string, itemId: string, clientId: unknown,
): VaultPresenceSession | null {
  if (typeof credential !== "string" || credential.length > 4096) return null;
  const parts = credential.split(":");
  if (parts.length !== 4 || parts[0] !== "v1" || parts.slice(1).some(part =>
    !part || Buffer.from(part, "base64url").toString("base64url") !== part,
  )) return null;
  try {
    const session = JSON.parse(decryptSecret(credential)) as VaultPresenceSession;
    return session.purpose === PURPOSE && session.principal === principal &&
      session.workspaceId === workspaceId && session.itemId === itemId &&
      session.clientId === clientId && /^p-[0-9a-f-]{36}$/.test(session.clientId) &&
      Number.isSafeInteger(session.epoch) && session.epoch > 0 &&
      Number.isSafeInteger(session.awarenessClientId) && session.awarenessClientId >= 0 &&
      session.awarenessClientId <= 0xffffffff &&
      Number.isSafeInteger(session.expiresAt) && session.expiresAt > Date.now()
      ? session : null;
  } catch { return null; }
}
