import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { auditCteFrom, auditValues } from "@/lib/audit";

describe("auditValues", () => {
  it("normalizes defaults and clips summaries", () => {
    const v = auditValues({
      actorType: "external_agent",
      actionName: "sync.delete_file",
      targetType: "item",
      inputSummary: "  a   long\n\tsummary  ",
    });
    expect(v.actorUserId).toBeNull();
    expect(v.targetId).toBeNull();
    expect(v.outputSummary).toBeNull();
    // whitespace collapsed and trimmed
    expect(v.inputSummary).toBe("a long summary");
  });

  it("caps an oversized summary at 300 characters", () => {
    const v = auditValues({
      actorType: "human",
      actionName: "x",
      targetType: "item",
      inputSummary: "x".repeat(500),
    });
    expect(v.inputSummary).not.toBeNull();
    expect(v.inputSummary!.length).toBe(300);
    expect(v.inputSummary!.endsWith("...")).toBe(true);
  });
});

describe("auditCteFrom", () => {
  it("emits an INSERT ... SELECT that reads the target id from the source CTE", () => {
    const fragment = auditCteFrom(
      {
        actorUserId: "11111111-1111-4111-8111-111111111111",
        actorType: "external_agent",
        actionName: "sync.delete_file",
        targetType: "item",
        inputSummary: "Title",
      },
      "changed",
      sql`changed.id::text`,
    );
    const compiled = new PgDialect().sqlToQuery(fragment);
    const lower = compiled.sql.toLowerCase();
    // Writes to the audit table, selects from the named CTE, and threads the
    // post-mutation id in as target_id (so the row lands iff the CTE matched).
    expect(lower).toContain('insert into "action_audit"');
    expect(lower).toContain('from "changed"');
    expect(compiled.sql).toContain("changed.id::text");
    // The normalized column values are bound as parameters, not inlined.
    expect(compiled.params).toContain("sync.delete_file");
    expect(compiled.params).toContain("external_agent");
  });
});
