import { getBlogEditAccess } from "@/lib/blog-edit-auth";
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
  let role = await collabAccess(user, postId, capability?.role ?? null);

  // A workspace created through /try has no owner account: the browser holds
  // the edit token that owns it. The editor's own server actions already treat
  // that token as full edit authority through getBlogEditAccess, so a guest can
  // create and save items. Collab did not consult it, so every keystroke in the
  // zero-setup demo failed to materialize and reported "Document could not be
  // saved" while the item saved fine by the other path. This grants no
  // authority the write actions do not already grant: the token must own the
  // very workspace that holds this post, and a claimed workspace never reaches
  // the token branch inside getBlogEditAccess.
  // getPostStoreContext excludes trashed rows, so a lookup that misses while
  // the caller was refused means the item is in Trash rather than forbidden.
  // Telling someone holding it open the wrong one leaves them wondering what
  // they did.
  const live = role ? null : await getPostStoreContext(postId);
  if (!role && !user && !capability && live) {
    const guest = await getBlogEditAccess(live.handle);
    if (guest.isUnclaimed && guest.isTokenEditor) role = "editor";
  }
  const trashed = !role && !live;

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
