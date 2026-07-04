import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "crypto";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/session";
import { getBlogEditRecord, isBlogOwner } from "@/lib/store";

const EDIT_COOKIE_PREFIX = "wr_edit_";
const EDIT_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 5;
const SEED_ADJECTIVES = [
  "bright",
  "quiet",
  "fresh",
  "open",
  "plain",
  "clear",
  "daily",
  "field",
] as const;
const SEED_NOUNS = [
  "notes",
  "pages",
  "draft",
  "letter",
  "studio",
  "ledger",
  "journal",
  "dispatch",
] as const;

export type BlogEditAccess = {
  canEdit: boolean;
  isOwner: boolean;
  isTokenEditor: boolean;
  isUnclaimed: boolean;
  blogId: string | null;
  ownerId: string | null;
  editTokenHash: string | null;
};

function randomSeedWord(values: readonly string[]): string {
  return values[randomInt(values.length)];
}

export function friendlyAnonymousSeed(): string {
  const suffix = randomBytes(2).toString("hex");
  return `${randomSeedWord(SEED_ADJECTIVES)}-${randomSeedWord(SEED_NOUNS)}-${suffix}`;
}

export function generateEditToken(): string {
  return `${randomUUID()}.${randomBytes(32).toString("base64url")}`;
}

export function hashEditToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function editCookieName(blogId: string): string {
  return `${EDIT_COOKIE_PREFIX}${blogId}`;
}

export async function setAnonymousEditCookie(
  blogId: string,
  token: string,
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set({
    name: editCookieName(blogId),
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: EDIT_TOKEN_MAX_AGE_SECONDS,
  });
}

export async function deleteAnonymousEditCookie(blogId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(editCookieName(blogId));
}

function safeHashMatches(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(actual) || !/^[a-f0-9]{64}$/i.test(expected)) {
    return false;
  }
  const actualBytes = Buffer.from(actual, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export async function getBlogEditAccess(
  handle: string,
): Promise<BlogEditAccess> {
  const record = await getBlogEditRecord(handle);
  if (!record) {
    return {
      canEdit: false,
      isOwner: false,
      isTokenEditor: false,
      isUnclaimed: false,
      blogId: null,
      ownerId: null,
      editTokenHash: null,
    };
  }

  if (record.ownerId) {
    const user = await getCurrentUser();
    const isOwner = user ? await isBlogOwner(handle, user.sub) : false;
    return {
      canEdit: isOwner,
      isOwner,
      isTokenEditor: false,
      isUnclaimed: false,
      blogId: record.id,
      ownerId: record.ownerId,
      editTokenHash: record.editTokenHash,
    };
  }

  const token = (await cookies()).get(editCookieName(record.id))?.value;
  const tokenHash = token ? hashEditToken(token) : "";
  const isTokenEditor = Boolean(
    tokenHash &&
      record.editTokenHash &&
      safeHashMatches(tokenHash, record.editTokenHash),
  );

  return {
    canEdit: isTokenEditor,
    isOwner: false,
    isTokenEditor,
    isUnclaimed: true,
    blogId: record.id,
    ownerId: null,
    editTokenHash: record.editTokenHash,
  };
}

export async function canEditBlog(handle: string): Promise<boolean> {
  return (await getBlogEditAccess(handle)).canEdit;
}
