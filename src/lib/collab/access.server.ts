import { cookies } from "next/headers";
import {
  collabAccess,
  colorForSub,
  type CollabRole,
} from "@/lib/collab";
import { documentCapabilityCookieName } from "@/lib/document-capability";
import { getCurrentUser, type CurrentUser } from "@/lib/session";
import {
  resolveDocumentCapability,
  type ResolvedDocumentCapability,
} from "@/lib/store";

export type CollabRequestAccess = {
  role: CollabRole | null;
  user: CurrentUser | null;
  capability: ResolvedDocumentCapability | null;
  userName: string;
  color: string;
};

export async function getCollabRequestAccess(
  postId: string,
): Promise<CollabRequestAccess> {
  const user = await getCurrentUser();
  const cookieStore = await cookies();
  const token = cookieStore.get(documentCapabilityCookieName(postId))?.value;
  const resolved = token ? await resolveDocumentCapability(token) : null;
  const capability = resolved?.itemId === postId ? resolved : null;
  const role = await collabAccess(user, postId, capability?.role ?? null);
  const userName =
    user?.name?.trim() ||
    user?.email?.trim() ||
    capability?.label?.trim() ||
    "Guest";
  const identity =
    user?.sub || user?.userId || capability?.id || `guest:${postId}`;
  return {
    role,
    user,
    capability,
    userName,
    color: colorForSub(identity),
  };
}
