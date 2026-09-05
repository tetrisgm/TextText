import { z } from "zod";

const record = z.object({
  id: z.string(),
  connectionId: z.string(),
  runId: z.string(),
  createdAt: z.string().datetime(),
  reverted: z.boolean(),
  revertsId: z.string().nullable(),
  changes: z.array(z.object({
    field: z.enum(["title", "subtitle", "body"]),
    before: z.string(),
    after: z.string(),
  })),
});
export type ParticipantChange = z.infer<typeof record>;

export function itemAgentChanges(payload: unknown, postId: string): ParticipantChange[] {
  const result = z.object({ itemId: z.literal(postId), changes: z.array(record) }).parse(payload);
  return result.changes.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export { changeSummary } from "./participant-change-summary";
