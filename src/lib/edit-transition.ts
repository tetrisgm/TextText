export const EDIT_TRANSITION_BUDGET_MS = 200;

type EditTransitionDataset = {
  writeEditStartId?: string;
  writeEditStart?: string;
  writeEditReadyMs?: string;
  writeEditReadyPostId?: string;
  writeEditReadyWithinBudget?: string;
};

export type EditTransitionResult = {
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
  dataset.writeEditStartId = postId;
  dataset.writeEditStart = String(now);
}

export function finishMeasuredEditTransition(
  dataset: EditTransitionDataset,
  postId: string,
  now: number,
  budgetMs = EDIT_TRANSITION_BUDGET_MS,
): EditTransitionResult | null {
  if (dataset.writeEditStartId !== postId) return null;
  const startedAt = Number(dataset.writeEditStart);
  delete dataset.writeEditStart;
  delete dataset.writeEditStartId;
  if (!Number.isFinite(startedAt)) return null;

  const elapsedMs = Math.max(0, now - startedAt);
  const withinBudget = elapsedMs <= budgetMs;
  dataset.writeEditReadyMs = elapsedMs.toFixed(1);
  dataset.writeEditReadyPostId = postId;
  dataset.writeEditReadyWithinBudget = String(withinBudget);
  return { postId, elapsedMs, budgetMs, withinBudget };
}
