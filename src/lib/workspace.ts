// The signed-in user's workspace, resolved the same way everywhere a session
// first touches content: an owned blog wins; otherwise the browser's
// unclaimed guest workspace is CLAIMED (signing in must never strand it);
// only when neither exists is a starter blog provisioned.

import {
  deleteAnonymousEditCookie,
  getActiveGuestBlogFromCookie,
} from "./blog-edit-auth";
import { recordAction } from "./audit";
import type { Blog } from "./content";
import { revalidateBlogPaths } from "./revalidate-blog";
import type { CurrentUser } from "./session";
import { claimBlogForUser, ensureOwnerBlog, getOwnedBlog } from "./store";

export async function resolveOwnedWorkspace(user: CurrentUser): Promise<Blog> {
  const owned = await getOwnedBlog(user.sub);
  if (owned) return ensureOwnerBlog(user);

  const guest = await getActiveGuestBlogFromCookie();
  if (guest) {
    try {
      const claimed = await claimBlogForUser(guest.handle, user);
      await deleteAnonymousEditCookie(guest.id);
      await recordAction({
        actorType: "human",
        actionName: "claim_workspace",
        targetType: "workspace",
        targetId: guest.id,
        inputSummary: claimed.handle,
      });
      revalidateBlogPaths(claimed);
      return claimed;
    } catch {
      // A concurrent claim or a race settles below; never block sign-in.
    }
  }

  return ensureOwnerBlog(user);
}
