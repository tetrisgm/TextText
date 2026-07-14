import { describe, expect, it } from "vitest";
import {
  EDIT_TRANSITION_BUDGET_MS,
  beginMeasuredEditTransition,
  finishMeasuredEditTransition,
} from "@/lib/edit-transition";

describe("edit transition performance gate", () => {
  it("records an edit surface that becomes ready inside the 200 ms budget", () => {
    const dataset: Record<string, string | undefined> = {};
    beginMeasuredEditTransition(dataset, "post-1", 100);

    expect(finishMeasuredEditTransition(dataset, "post-1", 249)).toEqual({
      postId: "post-1",
      elapsedMs: 149,
      budgetMs: EDIT_TRANSITION_BUDGET_MS,
      withinBudget: true,
    });
    expect(dataset.writeEditReadyMs).toBe("149.0");
    expect(dataset.writeEditReadyWithinBudget).toBe("true");
    expect(dataset.writeEditStart).toBeUndefined();
  });

  it("flags a transition that exceeds the budget", () => {
    const dataset: Record<string, string | undefined> = {};
    beginMeasuredEditTransition(dataset, "post-1", 100);

    const result = finishMeasuredEditTransition(dataset, "post-1", 301);

    expect(result?.withinBudget).toBe(false);
    expect(dataset.writeEditReadyWithinBudget).toBe("false");
  });

  it("ignores a stale completion from another item", () => {
    const dataset: Record<string, string | undefined> = {};
    beginMeasuredEditTransition(dataset, "post-2", 100);

    expect(finishMeasuredEditTransition(dataset, "post-1", 150)).toBeNull();
    expect(dataset.writeEditStartId).toBe("post-2");
  });
});
