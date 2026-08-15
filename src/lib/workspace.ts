// The signed-in user's workspace, resolved the same way everywhere a session
// first touches content: the owned blog, provisioned on first sign-in. The
// guest-workspace claim/import path was removed 2026-08-14 (docs/SPEC.md).

import type { Blog } from "./content";
import type { CurrentUser } from "./session";
import { ensureOwnerBlog } from "./store";

export async function resolveOwnedWorkspace(user: CurrentUser): Promise<Blog> {
  return ensureOwnerBlog(user);
}
