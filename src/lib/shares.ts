// Item-level sharing (the Notion model, one level deep): the owner invites a
// person BY EMAIL to a single post with a role; the invitee sees and (as an
// editor) edits that one item, nothing else in the workspace.
//
// Identity rules, read before editing:
// - Invites are keyed by normalized email because the person usually has no
//   account yet. userId starts null.
// - A signed-in session matches a share when its BOUND userId matches, or,
//   while unbound, when the session's provider-verified email equals the
//   invited email. On the first email match with an existing users row, the
//   share binds to that userId permanently (so a later email change on the
//   account does not drop access, and the email can never be re-matched by a
//   different identity provider account afterwards).
// - Sharing never changes publish state. Notes and bookmarks stay unlisted;
//   drafts stay drafts. A collaborator save is content-only (enforced in
//   the actions layer, see collaboratorSafePost).
//
// The owner is never a collaborator row: ownership short-circuits above this.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { recordAction } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { blogs, collaborators, posts, users } from "@/lib/db/schema";
import { getUserIdBySub } from "@/lib/store";

export type ShareRole = "editor" | "viewer";

export type PostShare = {
  id: string;
  email: string;
  role: ShareRole;
  /** true once the invitee has signed in and the share bound to their user */
  accepted: boolean;
  createdAt: string;
};

export type ShareUser = { sub: string; email?: string | null };

function cleanRole(value: string): ShareRole {
  return value === "editor" ? "editor" : "viewer";
}

export function normalizeShareEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidShareEmail(email: string): boolean {
  return EMAIL_RE.test(email) && email.length <= 254;
}

/** Active shares for one post, newest last (owner-facing list). */
export async function listPostShares(postId: string): Promise<PostShare[]> {
  if (!db) return [];
  const rows = await db
    .select()
    .from(collaborators)
    .where(
      and(
        eq(collaborators.scopeType, "item"),
        eq(collaborators.scopeId, postId),
        isNull(collaborators.revokedAt),
      ),
    );
  return rows
    .map((row) => ({
      id: row.id,
      email: row.invitedEmail ?? "",
      role: cleanRole(row.role),
      accepted: Boolean(row.userId),
      createdAt: row.createdAt.toISOString(),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Create (or re-role) an invite. Caller must ALREADY have verified the actor
 * owns the post's blog; this function only writes.
 */
export async function invitePostShare(opts: {
  postId: string;
  email: string;
  role: ShareRole;
  invitedBySub: string;
}): Promise<PostShare> {
  if (!db) throw new Error("Sharing needs a database.");
  const email = normalizeShareEmail(opts.email);
  if (!isValidShareEmail(email)) throw new Error("Enter a valid email address.");
  const invitedById = await getUserIdBySub(opts.invitedBySub);

  // If the address already has an active share, update the role in place.
  const existing = await db
    .select()
    .from(collaborators)
    .where(
      and(
        eq(collaborators.scopeType, "item"),
        eq(collaborators.scopeId, opts.postId),
        eq(collaborators.invitedEmail, email),
        isNull(collaborators.revokedAt),
      ),
    )
    .limit(1);
  if (existing[0]) {
    const updated = await db
      .update(collaborators)
      .set({ role: opts.role })
      .where(eq(collaborators.id, existing[0].id))
      .returning();
    const row = updated[0];
    return {
      id: row.id,
      email,
      role: cleanRole(row.role),
      accepted: Boolean(row.userId),
      createdAt: row.createdAt.toISOString(),
    };
  }

  // Bind immediately when the address already belongs to a known email-sub
  // user; other providers bind lazily on first access.
  const emailSubUser = await getUserIdBySub(`email:${email}`);
  const inserted = await db
    .insert(collaborators)
    .values({
      scopeType: "item",
      scopeId: opts.postId,
      invitedEmail: email,
      userId: emailSubUser,
      role: opts.role,
      invitedById,
    })
    .returning();
  const row = inserted[0];
  await recordAction({
    actorUserId: invitedById,
    actorType: "human",
    actionName: "share.invite",
    targetType: "item",
    targetId: opts.postId,
    inputSummary: `${email} as ${opts.role}`,
  });
  return {
    id: row.id,
    email,
    role: cleanRole(row.role),
    accepted: Boolean(row.userId),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Revoke one share (soft: revokedAt marker, the audit trail keeps the row). */
export async function revokePostShare(
  postId: string,
  shareId: string,
  revokedBySub: string,
): Promise<void> {
  if (!db) return;
  await db
    .update(collaborators)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(collaborators.id, shareId),
        eq(collaborators.scopeType, "item"),
        eq(collaborators.scopeId, postId),
        isNull(collaborators.revokedAt),
      ),
    );
  await recordAction({
    actorUserId: await getUserIdBySub(revokedBySub),
    actorType: "human",
    actionName: "share.revoke",
    targetType: "item",
    targetId: postId,
  });
}

/**
 * The share role this user holds on this post, or null. Binds the share to
 * the user's row on first email match (see the header comment).
 */
export async function postShareRoleFor(
  user: ShareUser | null,
  postId: string,
): Promise<ShareRole | null> {
  if (!db || !user) return null;
  const userId = await getUserIdBySub(user.sub);

  if (userId) {
    const bound = await db
      .select()
      .from(collaborators)
      .where(
        and(
          eq(collaborators.scopeType, "item"),
          eq(collaborators.scopeId, postId),
          eq(collaborators.userId, userId),
          isNull(collaborators.revokedAt),
        ),
      )
      .limit(1);
    if (bound[0]) return cleanRole(bound[0].role);
  }

  const email = user.email ? normalizeShareEmail(user.email) : "";
  if (!email) return null;
  const byEmail = await db
    .select()
    .from(collaborators)
    .where(
      and(
        eq(collaborators.scopeType, "item"),
        eq(collaborators.scopeId, postId),
        eq(collaborators.invitedEmail, email),
        isNull(collaborators.revokedAt),
      ),
    )
    .limit(1);
  const row = byEmail[0];
  if (!row) return null;
  if (row.userId && row.userId !== userId) {
    // Already bound to someone else: the email match no longer applies.
    return null;
  }
  if (!row.userId && userId) {
    await db
      .update(collaborators)
      .set({ userId })
      .where(and(eq(collaborators.id, row.id), isNull(collaborators.userId)));
  }
  return cleanRole(row.role);
}

/**
 * Everything shared with this user, for the workspace's "Shared with me"
 * section: bound rows plus unbound rows matching the session email.
 */
export async function listSharedWithMe(
  user: ShareUser | null,
): Promise<Array<{ postId: string; role: ShareRole }>> {
  if (!db || !user) return [];
  const userId = await getUserIdBySub(user.sub);
  const email = user.email ? normalizeShareEmail(user.email) : "";
  const rows = await db
    .select()
    .from(collaborators)
    .where(
      and(eq(collaborators.scopeType, "item"), isNull(collaborators.revokedAt)),
    );
  const mine = rows.filter((row) => {
    if (userId && row.userId === userId) return true;
    if (!row.userId && email && row.invitedEmail === email) return true;
    return false;
  });
  return mine.map((row) => ({
    postId: row.scopeId,
    role: cleanRole(row.role),
  }));
}

export type SharedWithMeEntry = {
  postId: string;
  role: ShareRole;
  title: string;
  slug: string;
  /** owning blog, for building the post path */
  blogHandle: string;
  blogUsername: string | null;
  blogName: string;
  updatedAt: string;
};

/**
 * The posts behind listSharedWithMe, joined with their owning blogs so the
 * workspace can render real links. Rows whose post has since been trashed
 * are dropped.
 */
export async function getSharedPostsForUser(
  user: ShareUser | null,
): Promise<SharedWithMeEntry[]> {
  if (!db || !user) return [];
  const shares = await listSharedWithMe(user);
  if (shares.length === 0) return [];
  const roleByPost = new Map(shares.map((s) => [s.postId, s.role]));
  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      slug: posts.slug,
      updatedAt: posts.updatedAt,
      deletedAt: posts.deletedAt,
      blogHandle: blogs.handle,
      blogName: blogs.name,
      blogUsername: users.username,
    })
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .leftJoin(users, eq(blogs.ownerId, users.id))
    .where(inArray(posts.id, [...roleByPost.keys()]));
  return rows
    .filter((row) => !row.deletedAt)
    .map((row) => ({
      postId: row.id,
      role: roleByPost.get(row.id) ?? "viewer",
      title: row.title,
      slug: row.slug,
      blogHandle: row.blogHandle,
      blogUsername: row.blogUsername ?? null,
      blogName: row.blogName,
      updatedAt: row.updatedAt.toISOString(),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** users.email for display in the workspace menu (null for guest subs). */
export async function emailForSub(sub: string): Promise<string | null> {
  if (!db) return null;
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.appleSub, sub))
    .limit(1);
  return rows[0]?.email ?? null;
}
