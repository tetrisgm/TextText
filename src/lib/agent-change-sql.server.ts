import { sql, type SQL } from "drizzle-orm";
import { agentChanges } from "@/lib/db/schema";
import { agentChangeContext, type AgentChangeActor } from "@/lib/agent-change-context.server";
import type { AgentTextChange } from "@/lib/agent-changes";

// Both callers embed this in the same statement as the guarded content write
// and action_audit. An empty source CTE cannot leave phantom history.
export function agentChangeCte(input: {
  source: string; postId: SQL; revision: SQL; changes: AgentTextChange[];
  epoch?: number; seq?: SQL;
  actor?: AgentChangeActor; captureGeneration?: string;
  revert?: { id: string; userId: string };
}): SQL {
  const actor = input.actor ?? agentChangeContext.getStore();
  if ((!actor && !input.revert) || (!input.changes.length && !input.revert && !input.captureGeneration)) return sql`SELECT 1`;
  return sql`INSERT INTO ${agentChanges}
    (post_id, actor_user_id, actor_type, connection_id, run_id, changes, revision, reverts_id, collab_epoch, collab_seq, capture_generation)
    SELECT ${input.postId}, ${input.revert?.userId ?? actor!.userId}::uuid,
      ${actor?.actorType ?? "human"},
      ${actor?.connectionId ?? `session:${input.revert!.userId}`},
      ${actor?.runId ?? `revert:${input.revert!.id}`},
      ${JSON.stringify(input.changes)}::jsonb, ${input.revision}, ${input.revert?.id ?? null}::uuid, ${input.epoch ?? null}, ${input.seq ?? sql`NULL`}, ${input.captureGeneration ?? null}
    FROM ${sql.identifier(input.source)}`;
}
