// The summary line for one agent change. Kept apart from the parser so the
// participant row, which every reader mounts, does not pull zod onto the cold
// path just to format a sentence.
import type { ParticipantChange } from "./participant-changes";
export function changeSummary(change: ParticipantChange): string {
  const fields = [...new Set(change.changes.map((field) => field.field))].join(", ");
  return `${change.revertsId ? "Reverted" : "Changed"} ${fields || "item content"}${change.reverted ? " (reverted)" : ""}`;
}
