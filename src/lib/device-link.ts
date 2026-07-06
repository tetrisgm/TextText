// Device-link handshake (a simplified RFC 8628 device flow): the app starts a
// link and holds a poll secret; the owner approves the short code in their
// signed-in browser; the app's next poll mints its api_token. The raw token
// is created only at claim time and returned once, straight to the app.

import { createHash, randomBytes, randomInt } from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { createApiToken } from "./api-tokens";
import { db } from "./db/client";
import { deviceLinks } from "./db/schema";

export const DEVICE_LINK_TTL_SECONDS = 10 * 60;

// No vowels and no ambiguous glyphs (0/O, 1/I): the code is read by humans.
const CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXZ23456789";

export type DeviceLinkStart = {
  code: string;
  pollToken: string;
  expiresAt: Date;
};

export type DeviceLinkPollResult =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "approved"; token: string; tokenName: string };

function hashPollToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateCode(): string {
  const pick = () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  const group = () => Array.from({ length: 4 }, pick).join("");
  return `${group()}-${group()}`;
}

export function cleanDeviceLinkCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code) ? code : null;
}

export function cleanAppName(value: unknown): string {
  if (typeof value !== "string") return "A device";
  const name = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return name || "A device";
}

/** Start a handshake: the app keeps pollToken, shows/opens code. */
export async function startDeviceLink(appName: string): Promise<DeviceLinkStart> {
  if (!db) throw new Error("device linking requires DATABASE_URL");
  const pollToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + DEVICE_LINK_TTL_SECONDS * 1000);

  // The code has a partial-unique index over unclaimed rows; retry collisions.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inserted = await db
      .insert(deviceLinks)
      .values({
        code: generateCode(),
        pollTokenHash: hashPollToken(pollToken),
        appName,
        expiresAt,
      })
      .onConflictDoNothing()
      .returning({ code: deviceLinks.code });
    if (inserted[0]) {
      return { code: inserted[0].code, pollToken, expiresAt };
    }
  }
  throw new Error("could not start a device link");
}

/** The pending link a signed-in owner is being asked to approve. */
export async function getPendingDeviceLink(
  code: string,
): Promise<{ id: string; appName: string; expiresAt: Date } | null> {
  if (!db) return null;
  const rows = await db
    .select({
      id: deviceLinks.id,
      appName: deviceLinks.appName,
      status: deviceLinks.status,
      expiresAt: deviceLinks.expiresAt,
    })
    .from(deviceLinks)
    .where(
      and(
        eq(deviceLinks.code, code),
        isNull(deviceLinks.claimedAt),
        gt(deviceLinks.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || row.status !== "pending") return null;
  return { id: row.id, appName: row.appName, expiresAt: row.expiresAt };
}

/** Approve a pending link as the signed-in user. */
export async function approveDeviceLink(
  code: string,
  userId: string,
): Promise<boolean> {
  if (!db) return false;
  const updated = await db
    .update(deviceLinks)
    .set({ status: "approved", approvedByUserId: userId })
    .where(
      and(
        eq(deviceLinks.code, code),
        eq(deviceLinks.status, "pending"),
        isNull(deviceLinks.claimedAt),
        gt(deviceLinks.expiresAt, new Date()),
      ),
    )
    .returning({ id: deviceLinks.id });
  return Boolean(updated[0]);
}

/**
 * The app's poll. On an approved link this MINTS the api_token (named after
 * the app) and marks the row claimed, so the raw token exists exactly once,
 * in this response.
 */
export async function pollDeviceLink(
  pollToken: string,
): Promise<DeviceLinkPollResult> {
  if (!db) return { status: "expired" };
  const rows = await db
    .select({
      id: deviceLinks.id,
      status: deviceLinks.status,
      appName: deviceLinks.appName,
      approvedByUserId: deviceLinks.approvedByUserId,
      expiresAt: deviceLinks.expiresAt,
      claimedAt: deviceLinks.claimedAt,
    })
    .from(deviceLinks)
    .where(eq(deviceLinks.pollTokenHash, hashPollToken(pollToken)))
    .limit(1);
  const row = rows[0];
  if (!row || row.claimedAt || row.expiresAt < new Date()) {
    return { status: "expired" };
  }
  if (row.status !== "approved" || !row.approvedByUserId) {
    return { status: "pending" };
  }

  // Claim exactly once: the row flips before the token is handed out, so a
  // racing second poll gets "expired" rather than a second token.
  const claimed = await db
    .update(deviceLinks)
    .set({ claimedAt: new Date() })
    .where(and(eq(deviceLinks.id, row.id), isNull(deviceLinks.claimedAt)))
    .returning({ id: deviceLinks.id });
  if (!claimed[0]) return { status: "expired" };

  const { raw } = await createApiToken(row.approvedByUserId, row.appName);
  return { status: "approved", token: raw, tokenName: row.appName };
}
