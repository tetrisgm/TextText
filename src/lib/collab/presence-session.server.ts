import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";

const PURPOSE = "collab-presence-v1";
export const PRESENCE_SESSION_MS = 24 * 60 * 60 * 1000;

export type PresenceSession = {
  purpose: typeof PURPOSE;
  principal: string;
  postId: string;
  clientId: string;
  awarenessClientId: number;
  expiresAt: number;
};

/** No database row is created until the credential is presented for a heartbeat. */
export function issuePresenceSession(
  principal: string,
  postId: string,
  awarenessClientId: number,
) {
  const session: PresenceSession = {
    purpose: PURPOSE,
    principal,
    postId,
    clientId: `p-${randomUUID()}`,
    awarenessClientId,
    expiresAt: Date.now() + PRESENCE_SESSION_MS,
  };
  return {
    clientId: session.clientId,
    sessionCredential: encryptSecret(JSON.stringify(session)),
    expiresAt: session.expiresAt,
  };
}

export function verifyPresenceSession(
  credential: unknown,
  principal: string,
  postId: string,
  clientId: unknown,
): PresenceSession | null {
  if (typeof credential !== "string" || credential.length > 4096) return null;
  const parts = credential.split(":");
  if (parts.length !== 4 || parts[0] !== "v1" || parts.slice(1).some((part) =>
    !part || Buffer.from(part, "base64url").toString("base64url") !== part,
  )) return null;
  try {
    const session = JSON.parse(decryptSecret(credential)) as PresenceSession;
    if (
      session.purpose !== PURPOSE ||
      session.principal !== principal ||
      session.postId !== postId ||
      session.clientId !== clientId ||
      !/^p-[0-9a-f-]{36}$/.test(session.clientId) ||
      !Number.isSafeInteger(session.awarenessClientId) ||
      session.awarenessClientId < 0 ||
      !Number.isSafeInteger(session.expiresAt) ||
      session.expiresAt <= Date.now()
    ) return null;
    return session;
  } catch {
    return null;
  }
}
