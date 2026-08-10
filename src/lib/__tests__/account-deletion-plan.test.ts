// The deletion ORDER, asserted without a database.
//
// Every phase in accountDeletionPlan() exists because the next one is blocked
// by a NO ACTION foreign key or by an address that is about to be destroyed.
// Reordering any pair silently breaks the deletion in a way that is hard to see
// in review and only shows up against real data, so the order is pinned here as
// a fact rather than a convention.

import { describe, expect, it } from "vitest";

delete process.env.DATABASE_URL;

const { accountDeletionPlan } = await import("@/lib/account-deletion");

function orderOf(step: string): number {
  return accountDeletionPlan().findIndex((entry) => entry.step === step);
}

describe("accountDeletionPlan", () => {
  it("closes the account before doing anything irreversible", () => {
    expect(accountDeletionPlan()[0]?.step).toBe("close");
  });

  it("collects blobs before the rows that carry their addresses are deleted", () => {
    expect(orderOf("blobs")).toBeLessThan(orderOf("content"));
  });

  it("empties the workspace before deleting the workspace row", () => {
    expect(orderOf("content")).toBeLessThan(orderOf("workspace"));
  });

  it("clears the workspace before the user-level rows", () => {
    expect(orderOf("workspace")).toBeLessThan(orderOf("identity"));
  });

  it("nulls the audit actor before the users row it references is deleted", () => {
    expect(orderOf("audit")).toBeLessThan(orderOf("finish"));
  });

  it("deletes the users row last", () => {
    const plan = accountDeletionPlan();
    expect(plan[plan.length - 1]?.step).toBe("finish");
  });

  it("explains why every phase sits where it does", () => {
    for (const entry of accountDeletionPlan()) {
      expect(entry.because.length).toBeGreaterThan(20);
    }
  });
});
