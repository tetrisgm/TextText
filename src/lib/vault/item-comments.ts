import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { packIdentity } from "@/local-vault/pack";

const MAX_COMMENTS = 500;
const MAX_COMMENT_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fixedDate = new Date(1980, 0, 1);
type ActorType = "human" | "external_agent";
export type VaultItemComment = {
  id: string; parentId: string | null; body: string; imageAssetId?: string;
  authorUserId: string; authorName: string; authorActorType: ActorType;
  createdAt: string; updatedAt: string; resolvedAt: string | null;
  resolvedByUserId: string | null; resolvedByActorType: ActorType | null;
};
export type VaultCommentMutation =
  | { kind: "create"; body: string; parentId?: string | null; imageAssetId?: string }
  | { kind: "resolve"; commentId: string; resolved: boolean };
export type VaultCommentActor = { userId: string; name: string; type: ActorType; authorType?: ActorType };

export class VaultCommentInputError extends Error {}
export class VaultCommentNotFoundError extends Error {}
export class VaultCommentCapacityError extends Error {}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function iso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
function cleanBody(value: unknown): string {
  if (typeof value !== "string") throw new VaultCommentInputError("A comment body is required");
  const body = value.trim();
  if (!body || body.length > 4000) throw new VaultCommentInputError("Comment body must contain 1 to 4000 characters");
  return body;
}
function checkedRows(value: unknown): VaultItemComment[] {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.comments) || value.comments.length > MAX_COMMENTS) {
    throw new Error("Invalid TextPack comments");
  }
  const seen = new Map<string, VaultItemComment>();
  for (const row of value.comments) {
    if (!object(row) || typeof row.id !== "string" || !UUID.test(row.id) || seen.has(row.id) ||
        (row.parentId !== null && (typeof row.parentId !== "string" || !UUID.test(row.parentId))) ||
        (row.imageAssetId !== undefined && (typeof row.imageAssetId !== "string" || !row.imageAssetId.trim() || row.imageAssetId.length > 120)) ||
        typeof row.body !== "string" || !row.body.trim() || row.body.length > 4000 ||
        typeof row.authorUserId !== "string" || !UUID.test(row.authorUserId) ||
        typeof row.authorName !== "string" || !row.authorName.trim() || row.authorName.length > 80 ||
        (row.authorActorType !== "human" && row.authorActorType !== "external_agent") ||
        !iso(row.createdAt) || !iso(row.updatedAt) ||
        (row.resolvedAt !== null && !iso(row.resolvedAt)) ||
        (row.resolvedByUserId !== null && (typeof row.resolvedByUserId !== "string" || !UUID.test(row.resolvedByUserId))) ||
        (row.resolvedByActorType !== null && row.resolvedByActorType !== "human" && row.resolvedByActorType !== "external_agent") ||
        (row.resolvedAt === null) !== (row.resolvedByUserId === null) ||
        (row.resolvedAt === null) !== (row.resolvedByActorType === null)) {
      throw new Error("Invalid TextPack comment row");
    }
    if (row.parentId !== null) {
      const parent = seen.get(row.parentId);
      if (!parent || parent.parentId !== null || row.resolvedAt !== null || row.imageAssetId !== parent.imageAssetId) throw new Error("Invalid TextPack comment reply");
    }
    seen.set(row.id, row as VaultItemComment);
  }
  return [...seen.values()];
}
function pack(bytes: Uint8Array, itemId: string) {
  if (bytes.length > 64 * 1024 * 1024) throw new Error("TextPack is too large");
  let size = 0, count = 0;
  const entries = unzipSync(bytes, { filter(entry) {
    if (++count > 10_000 || (size += entry.originalSize) > 256 * 1024 * 1024) throw new Error("TextPack exceeds limits");
    if (entry.name.startsWith("/") || entry.name.includes("\\") || entry.name.split("/").includes("..")) throw new Error("Invalid TextPack entry");
    return true;
  } });
  const documents = Object.keys(entries).filter(name => name === "document.json" || name.endsWith("/document.json"));
  if (documents.length !== 1) throw new Error("Invalid TextPack document");
  const prefix = documents[0].slice(0, -"document.json".length);
  if (!entries[prefix + "text.md"] || packIdentity(strFromU8(entries[prefix + "text.md"])) !== itemId) throw new Error("Invalid TextPack identity");
  const encoded = entries[prefix + "comments.json"];
  if (encoded && encoded.length > MAX_COMMENT_BYTES) throw new Error("TextPack comments exceed limit");
  const comments = encoded ? checkedRows(JSON.parse(strFromU8(encoded))) : [];
  return { entries, prefix, comments };
}

export function readVaultItemCommentsFromPack(bytes: Uint8Array, itemId: string, limit = 50, after?: string | null) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (after && !UUID.test(after))) throw new VaultCommentInputError("Invalid comment cursor or limit");
  const rows = pack(bytes, itemId).comments;
  const start = after ? rows.findIndex(row => row.id === after) + 1 : 0;
  if (after && start === 0) throw new VaultCommentInputError("Comment cursor was not found");
  const comments = rows.slice(start, start + limit);
  return { comments, nextCursor: start + limit < rows.length ? comments.at(-1)?.id ?? null : null };
}

export function mutateVaultItemCommentsInPack(bytes: Uint8Array, itemId: string, operationId: string,
  mutation: VaultCommentMutation, actor: VaultCommentActor) {
  if (!UUID.test(operationId) || !UUID.test(actor.userId) || !actor.name.trim() || actor.name.length > 80 ||
      (actor.type !== "human" && actor.type !== "external_agent") ||
      (actor.authorType !== undefined && actor.authorType !== "human" && actor.authorType !== "external_agent")) {
    throw new VaultCommentInputError("Invalid comment actor or operation");
  }
  const current = pack(bytes, itemId);
  const comments = [...current.comments];
  let commentId: string;
  if (mutation.kind === "create") {
    const body = cleanBody(mutation.body);
    const parentId = mutation.parentId ?? null;
    let imageAssetId = mutation.imageAssetId;
    if (imageAssetId !== undefined && (typeof imageAssetId !== "string" || !imageAssetId.trim() || imageAssetId.length > 120)) throw new VaultCommentInputError("Invalid image anchor");
    if (parentId !== null) {
      if (!UUID.test(parentId)) throw new VaultCommentInputError("Invalid parent comment");
      const parent = comments.find(row => row.id === parentId && row.parentId === null);
      if (!parent) throw new VaultCommentNotFoundError("Parent comment not found");
      if (imageAssetId !== undefined && imageAssetId !== parent.imageAssetId) throw new VaultCommentInputError("Reply image does not match its thread");
      imageAssetId = parent.imageAssetId;
      if (parent.resolvedAt) throw new VaultCommentInputError("A resolved thread cannot receive replies");
    }
    if (parentId === null && imageAssetId !== undefined) {
      const document = JSON.parse(strFromU8(current.entries[current.prefix + "document.json"]));
      const assets = document?.content?.assets;
      if (!Array.isArray(assets) || assets.filter((asset: { id?: string; kind?: string }) => asset.id === imageAssetId && asset.kind === "image").length !== 1) {
        throw new VaultCommentInputError("This image is no longer in the file");
      }
    }
    if (comments.length >= MAX_COMMENTS) throw new VaultCommentCapacityError("This item has too many comments");
    if (comments.some(row => row.id === operationId)) throw new VaultCommentInputError("Comment operation was reused");
    const now = new Date().toISOString();
    commentId = operationId;
    comments.push({ id: commentId, parentId, body, ...(imageAssetId === undefined ? {} : { imageAssetId }), authorUserId: actor.userId, authorName: actor.name.trim(),
      authorActorType: actor.authorType ?? actor.type, createdAt: now, updatedAt: now, resolvedAt: null,
      resolvedByUserId: null, resolvedByActorType: null });
  } else {
    if (typeof mutation.commentId !== "string" || !UUID.test(mutation.commentId) || typeof mutation.resolved !== "boolean") {
      throw new VaultCommentInputError("Invalid comment resolution");
    }
    const index = comments.findIndex(row => row.id === mutation.commentId && row.parentId === null);
    if (index < 0) throw new VaultCommentNotFoundError("Comment thread not found");
    commentId = mutation.commentId;
    if (Boolean(comments[index].resolvedAt) === mutation.resolved) return { bytes, commentId, changed: false };
    const now = new Date().toISOString();
    comments[index] = { ...comments[index], updatedAt: now,
      resolvedAt: mutation.resolved ? now : null,
      resolvedByUserId: mutation.resolved ? actor.userId : null,
      resolvedByActorType: mutation.resolved ? actor.authorType ?? actor.type : null };
  }
  const encoded = strToU8(JSON.stringify({ schemaVersion: 1, comments }));
  if (encoded.length > MAX_COMMENT_BYTES) throw new VaultCommentCapacityError("TextPack comments exceed limit");
  current.entries[current.prefix + "comments.json"] = encoded;
  const next = zipSync(Object.fromEntries(Object.keys(current.entries).sort().map(name =>
    [name, [current.entries[name], { level: 0, mtime: fixedDate }]])), { level: 0, mtime: fixedDate });
  return { bytes: next, commentId, changed: true };
}
