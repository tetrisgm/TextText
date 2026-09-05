import type { DocumentSnapshot } from "@/lib/documents/model";

export const AGENT_TEXT_FIELDS = ["title", "subtitle", "body"] as const;
export type AgentTextField = (typeof AGENT_TEXT_FIELDS)[number];
export type AgentTextChange = { field: AgentTextField; before: string; after: string };

export function agentTextChanges(before: DocumentSnapshot | null, after: DocumentSnapshot): AgentTextChange[] {
  return AGENT_TEXT_FIELDS.flatMap((field) => {
    const oldText = before?.content[field] ?? "";
    const newText = after.content[field] ?? "";
    return oldText === newText ? [] : [{ field, before: oldText, after: newText }];
  });
}

export class AgentChangeConflictError extends Error {
  constructor(public readonly comparisons: (AgentTextChange & { current: string })[]) {
    super("This text changed after the agent edit. Review the comparison before changing it.");
  }
}

// Prefix-first and suffix-first alignment bound every equally short single
// replacement. Repeated characters can put the same edit on either side of an
// inverse; keep that ambiguity instead of silently picking an anchor.
function changeBounds(before: string, after: string) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length && suffix < after.length &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const shortest = Math.min(before.length, after.length);
  return { start: prefix, earliestStart: Math.min(prefix, shortest - suffix),
    suffix: Math.min(suffix, shortest - prefix) };
}

// One changed span per field. Later edits wholly outside every possible span
// are preserved. Disjoint edits whose combined span crosses it also conflict.
export function inverseTextChange(change: AgentTextChange, current: string) {
  const { before, after } = change;
  const { start, earliestStart, suffix } = changeBounds(before, after);
  let offset = start;
  const end = after.length - suffix;
  if (current !== after) {
    const human = changeBounds(after, current);
    const humanEnd = after.length - human.suffix;
    // Strict boundaries refuse adjacent insertions/deletions as ambiguous.
    if (humanEnd < earliestStart) offset += current.length - after.length;
    else if (human.earliestStart > end) { /* the edit is after the agent span */ }
    else throw new AgentChangeConflictError([{ ...change, current }]);
  }
  return { field: change.field, start: offset, end: offset + end - start,
    expectedText: after.slice(start, end), replacementText: before.slice(start, before.length - suffix) };
}
