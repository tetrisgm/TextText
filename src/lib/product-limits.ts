// Server-enforced product limits by pricing tier. UI copy mirrors these but
// the server is the enforcement point.

export type PlanTier = "free" | "paid";

type PlanLimits = {
  /** live items per workspace, across folders */
  maxPosts: number;
  allowMediaUploads: boolean;
  /** invited collaborators per workspace (owner excluded) */
  maxCollaborators: number;
  /** external agent/sync tokens */
  allowApiTokens: boolean;
};

const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
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

export function cleanPlanTier(value: unknown): PlanTier {
  return value === "paid" ? "paid" : "free";
}
