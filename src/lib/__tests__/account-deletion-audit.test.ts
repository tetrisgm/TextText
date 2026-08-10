// The audit history survives the account.
//
// action_audit rows are the accountability record for every mutation, including
// the ones made by AI and by external agents. Deleting an account severs the
// actor and keeps the row. A future refactor that "tidies up" by deleting them
// instead would destroy the record silently, so the absence of that statement is
// asserted here against the source rather than trusted to review.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const storeSource = readFileSync("src/lib/store.ts", "utf8");
const orchestratorSource = readFileSync("src/lib/account-deletion.ts", "utf8");

describe("account deletion and the audit log", () => {
  it("never deletes from action_audit", () => {
    for (const source of [storeSource, orchestratorSource]) {
      expect(source).not.toMatch(/delete\s*\(\s*actionAudit\s*\)/);
      expect(source).not.toMatch(/delete\s+from\s+action_audit/i);
    }
  });

  it("nulls the actor instead", () => {
    expect(storeSource).toMatch(/anonymizeAuditActor/);
    expect(storeSource).toMatch(/set\(\{\s*actorUserId:\s*null\s*\}\)/);
  });

  it("chunks the actor null-out rather than issuing one unbounded update", () => {
    // Every save writes an audit row, so an active account can hold six figures
    // of them; one statement would risk the function budget.
    const body = storeSource.slice(storeSource.indexOf("export async function anonymizeAuditActor"));
    expect(body).toMatch(/batchSize/);
    expect(body).toMatch(/limit\(batchSize\)/);
  });

  it("writes the deletion's own audit row while the users row still exists", () => {
    // The audit insert has to be inside the CLOSE batch: a moment later there
    // is no users row for action_audit.actor_user_id to point at.
    const close = orchestratorSource.slice(
      orchestratorSource.indexOf("export async function closeAccount"),
      orchestratorSource.indexOf("export async function purgeAccount"),
    );
    expect(close).toMatch(/auditInsertQuery/);
    expect(close).toMatch(/actionName: "delete_account"/);
    expect(close).toMatch(/actorUserId: summary\.userId/);
  });
});
