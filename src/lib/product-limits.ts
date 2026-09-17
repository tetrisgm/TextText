// Server-enforced product limits by pricing tier. UI copy mirrors these but
// the server is the enforcement point.
//
// Feed articles are counted apart from authored items on purpose. They are a
// cache: retention expires them, nobody wrote them, and losing one costs
// nothing. Counted together, following sixteen publishers filled a free
// workspace's whole allowance in a day, after which every later poll refused
// to import and half the channels stayed permanently empty. A news surface
// that stops bringing news is not a news surface.

export type PlanTier = "free" | "paid";

type PlanLimits = {
  /** live authored items per workspace, across folders */
  maxPosts: number;
  /** imported feed articles per workspace, counted apart from authored work */
  maxFeedItems: number;
  allowMediaUploads: boolean;
  /** invited collaborators per workspace (owner excluded) */
  maxCollaborators: number;
  /** external agent/sync tokens */
  allowApiTokens: boolean;
};

const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    maxPosts: 200,
    maxFeedItems: 1500,
    allowMediaUploads: true,
    maxCollaborators: 0,
    allowApiTokens: true,
  },
  paid: {
    maxPosts: 10000,
    maxFeedItems: 20000,
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
