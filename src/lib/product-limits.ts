// Server-enforced product limits by pricing tier. Guests (no account) are the
// try-before-signup tier; free is durable ownership; paid is serious
// publishing. UI copy mirrors these but the server is the enforcement point.

export type PlanTier = "anonymous" | "free" | "paid";

export type PlanLimits = {
  /** live items per workspace, across folders */
  maxPosts: number;
  allowMediaUploads: boolean;
  /** invited collaborators per workspace (owner excluded) */
  maxCollaborators: number;
  /** external agent/sync tokens */
  allowApiTokens: boolean;
};

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  anonymous: {
    maxPosts: 3,
    allowMediaUploads: false,
    maxCollaborators: 0,
    allowApiTokens: false,
  },
  free: {
    maxPosts: 200,
    allowMediaUploads: true,
    maxCollaborators: 0,
    allowApiTokens: true,
  },
  paid: {
    maxPosts: 10000,
    allowMediaUploads: true,
    maxCollaborators: 25,
    allowApiTokens: true,
  },
};

export function planLimits(tier: PlanTier): PlanLimits {
  return PLAN_LIMITS[tier];
}

export function cleanPlanTier(value: unknown): Exclude<PlanTier, "anonymous"> {
  return value === "paid" ? "paid" : "free";
}

// Back-compat aliases for the guest tier (existing call sites).
export const ANONYMOUS_MAX_POSTS = PLAN_LIMITS.anonymous.maxPosts;
export const ANONYMOUS_ALLOW_MEDIA_UPLOADS =
  PLAN_LIMITS.anonymous.allowMediaUploads;

export const ANONYMOUS_POST_LIMIT_COPY = "Sign in to keep writing.";

export const ANONYMOUS_MEDIA_UPLOAD_COPY = "Sign in to keep media recoverable.";
