import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { agentChangeContext } from "@/lib/agent-change-context.server";
import { agentChangeCte } from "@/lib/agent-change-sql.server";

const actor = { userId: "user", connectionId: "authenticated-row", runId: "server-run", actorType: "external_agent" as const };
const changes = [{ field: "body" as const, before: "Private before", after: "Private after" }];
const input = { source: "changed", postId: sql`changed.id`, revision: sql`changed.revision`, changes };
const compile = () => new PgDialect().sqlToQuery(agentChangeCte(input));

describe("agent history SQL and request isolation", () => {
  it("selects history from the guarded write and binds content and identity as parameters", () => {
    const query = agentChangeContext.run(actor, compile);
    expect(query.sql).toContain('INSERT INTO "agent_changes"');
    expect(query.sql).toContain('FROM "changed"');
    expect(query.sql).toContain("changed.revision");
    expect(query.sql).not.toContain("Private before");
    expect(query.params).toEqual(expect.arrayContaining([actor.userId, actor.connectionId, actor.runId, JSON.stringify(changes)]));
  });
  it("keeps human saves out of agent history", () => {
    expect(compile().sql).toBe("SELECT 1");
  });
  it("retains the authenticated origin across asynchronous capture completion", () => {
    const query = agentChangeContext.run(actor, () => new PgDialect().sqlToQuery(agentChangeCte({ ...input, changes: [], captureGeneration: "generation-1" })));
    expect(query.sql).toContain('INSERT INTO "agent_changes"');
    expect(query.params).toContain("generation-1");
    const completion = new PgDialect().sqlToQuery(agentChangeCte({ ...input, actor }));
    expect(completion.params).toContain("authenticated-row");
  });
  it("can retain a deleted account's non-secret provenance", () => {
    const query = new PgDialect().sqlToQuery(agentChangeCte({ ...input, actor: { ...actor, userId: null } }));
    expect(query.params).toContain(null);
    expect(query.params).toContain("authenticated-row");
  });
  it("isolates simultaneous connections and runs across awaits", async () => {
    const queries = await Promise.all(["a", "b"].map((id) => agentChangeContext.run({ ...actor, connectionId: id, runId: `run-${id}` }, async () => {
      await Promise.resolve(); return compile();
    })));
    expect(queries[0].params).toContain("a"); expect(queries[0].params).not.toContain("b");
    expect(queries[1].params).toContain("b"); expect(queries[1].params).not.toContain("a");
    expect(agentChangeContext.getStore()).toBeUndefined();
  });
});
