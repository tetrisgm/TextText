export const EDIT_TRANSITION_BUDGET_MS = 200;

type EditTransitionDataset = {
  textTextEditStartId?: string;
  textTextEditStart?: string;
  textTextEditReadyMs?: string;
  textTextEditReadyPostId?: string;
  textTextEditReadyWithinBudget?: string;
};

type EditTransitionResult = {
  postId: string;
  elapsedMs: number;
  budgetMs: number;
  withinBudget: boolean;
};

export function beginMeasuredEditTransition(
  dataset: EditTransitionDataset,
  postId: string,
  now: number,
): void {
  dataset.textTextEditStartId = postId;
  dataset.textTextEditStart = String(now);
}

export function finishMeasuredEditTransition(
  dataset: EditTransitionDataset,
  postId: string,
  now: number,
  budgetMs = EDIT_TRANSITION_BUDGET_MS,
): EditTransitionResult | null {
  if (dataset.textTextEditStartId !== postId) return null;
  const startedAt = Number(dataset.textTextEditStart);
  delete dataset.textTextEditStart;
  delete dataset.textTextEditStartId;
  if (!Number.isFinite(startedAt)) return null;

  const elapsedMs = Math.max(0, now - startedAt);
  const withinBudget = elapsedMs <= budgetMs;
  dataset.textTextEditReadyMs = elapsedMs.toFixed(1);
  dataset.textTextEditReadyPostId = postId;
  dataset.textTextEditReadyWithinBudget = String(withinBudget);
  return { postId, elapsedMs, budgetMs, withinBudget };
}
