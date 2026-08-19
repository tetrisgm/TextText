import {
  collabAccess,
  colorForSub,
  type CollabRole,
} from "@/lib/collab";
import { documentCapabilityCookieName } from "@/lib/document-capability";
import { getCurrentUser, type CurrentUser } from "@/lib/session";
import {
  getPostStoreContext,
  resolveDocumentCapability,
  type ResolvedDocumentCapability,
} from "@/lib/store";
import { isUuid } from "@/lib/permissions";

export type CollabRequestAccess = {
  role: CollabRole | null;
  /** The item exists but is in Trash: a different answer from "no access". */
  trashed: boolean;
  user: CurrentUser | null;
  capability: ResolvedDocumentCapability | null;
  userName: string;
  color: string;
};

export async function getCollabRequestAccess(
  request: Request,
  postId: string,
): Promise<CollabRequestAccess> {
  const user = await getCurrentUser();
  const cookieName = documentCapabilityCookieName(postId);
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  const resolved = token ? await resolveDocumentCapability(token) : null;
  const capability = resolved?.itemId === postId ? resolved : null;
  const role = await collabAccess(user, postId, capability?.role ?? null);

  // getPostStoreContext excludes trashed rows, so a lookup that misses while
  // the caller was refused means the item is in Trash rather than forbidden.
  // Telling someone holding it open the wrong one leaves them wondering what
  // they did.
  const live = role || !isUuid(postId) ? null : await getPostStoreContext(postId);
  const trashed = !role && isUuid(postId) && !live;

  const userName =
    user?.name?.trim() ||
    user?.email?.trim() ||
    capability?.label?.trim() ||
    "Guest";
  const identity =
    user?.sub || user?.userId || capability?.id || `guest:${postId}`;
  return {
    role,
    trashed,
    user,
    capability,
    userName,
    color: colorForSub(identity),
  };
}
