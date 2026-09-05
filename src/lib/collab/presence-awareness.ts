// Shared by the HTTP boundary and provider. Never apply an opaque awareness blob.
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { fromBase64, toBase64 } from "lib0/buffer";
import * as Y from "yjs";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bytes(value: unknown, limit: number): Uint8Array {
  if (typeof value !== "string" || !value.length || value.length > limit ||
      value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("Invalid awareness encoding");
  }
  const result = fromBase64(value);
  if (toBase64(result) !== value) throw new Error("Invalid awareness encoding");
  return result;
}

export function decodePresenceAwareness(value: unknown) {
  const decoder = decoding.createDecoder(bytes(value, 16 * 1024));
  if (decoding.readVarUint(decoder) !== 1) throw new Error("One awareness client is required");
  const clientId = decoding.readVarUint(decoder);
  const clock = decoding.readVarUint(decoder);
  if (!Number.isSafeInteger(clientId) || clientId < 0 ||
      !Number.isSafeInteger(clock) || clock < 0 || clock > 0xffffffff) {
    throw new Error("Invalid awareness counter");
  }
  const state: unknown = JSON.parse(decoding.readVarString(decoder));
  if (decoder.pos !== decoder.arr.length || (state !== null && !object(state))) {
    throw new Error("Invalid awareness state");
  }
  return { clientId, clock, state };
}

export function encodePresenceAwareness(
  clientId: number,
  clock: number,
  state: Record<string, unknown> | null,
): string {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 1);
  encoding.writeVarUint(encoder, clientId);
  encoding.writeVarUint(encoder, clock);
  encoding.writeVarString(encoder, JSON.stringify(state));
  return toBase64(encoding.toUint8Array(encoder));
}

function selection(value: unknown) {
  if (value == null) return null;
  if (!object(value) || typeof value.field !== "string" || !["title", "subtitle", "body"].includes(value.field)) {
    throw new Error("Invalid awareness selection");
  }
  for (const position of [value.anchor, value.head]) {
    const encoded = bytes(position, 2048);
    // Round-trip rejects trailing bytes as well as malformed relative positions.
    if (toBase64(Y.encodeRelativePosition(Y.decodeRelativePosition(encoded))) !== position) {
      throw new Error("Invalid awareness position");
    }
  }
  return { field: value.field, anchor: value.anchor, head: value.head };
}

/** Strip all caller identity, focus commands and arbitrary state fields. */
export function sanitizePresenceAwareness(
  value: unknown,
  registeredClientId: number,
  user: { clientId: string; name: string; color: string; role: "editor" | "viewer" },
): string {
  const decoded = value == null ? null : decodePresenceAwareness(value);
  if (decoded && decoded.clientId !== registeredClientId) {
    throw new Error("Awareness client does not match the session");
  }
  // Server-issued UUID supplies a wire ID outside Yjs's ordinary uint32 range.
  // Receivers also allocate IDs per session, so even a numeric collision cannot
  // cross identities (including server-built agent awareness).
  const wireId = 0x100000000 + Number.parseInt(user.clientId.slice(2).replaceAll("-", "").slice(0, 12), 16);
  return encodePresenceAwareness(wireId, Math.max(1, decoded?.clock ?? 1), {
    user: { ...user, participantType: "person" },
    selection: selection(decoded?.state?.selection),
  });
}
