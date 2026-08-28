// Pure poll semantics, shared by the public respond route, the renderer, and
// tests. A poll's OPTIONS are content (a rows field the author edits like any
// other), while READER RESPONSES live in their own table. These helpers answer
// the questions both sides ask: which node is the poll, what are its option
// labels right now, is it still open, and is a submission valid against it.

import type { DocumentSnapshot } from "./model";
import type { RenderNode, TemplateDefinition } from "@/lib/presentation/schema";

type PollNodeSpec = Extract<RenderNode, { type: "poll" }>;

function walk(node: RenderNode, visit: (node: RenderNode) => void): void {
  visit(node);
  if ("children" in node) {
    for (const child of node.children) walk(child, visit);
  }
}

/** The poll node bound to content.fields.<fieldId>, if the template has one. */
export function findPollNode(
  template: TemplateDefinition,
  fieldId: string,
): PollNodeSpec | null {
  let found: PollNodeSpec | null = null;
  walk(template.item as RenderNode, (node) => {
    if (node.type === "poll" && node.bind === `content.fields.${fieldId}`) {
      found = node as PollNodeSpec;
    }
  });
  return found;
}

/** The current option labels, in document order, trimmed and deduplicated.
 * Labels are the vote keys: renaming an option orphans its old votes, which
 * is the honest behavior for an edited ballot. */
export function pollOptionLabels(
  document: DocumentSnapshot,
  poll: PollNodeSpec,
): string[] {
  const fieldId = poll.bind.slice("content.fields.".length);
  const rows = document.content.fields[fieldId];
  if (!Array.isArray(rows)) return [];
  const labelId = poll.labelBind.slice("row.".length);
  const labels: string[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
    const raw = (row as Record<string, unknown>)[labelId];
    if (typeof raw !== "string") continue;
    const label = raw.trim();
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

/** Closed when the bound close date exists and is in the past. No close
 * binding, or an unset or unparsable date, means the poll stays open. */
export function pollClosed(
  document: DocumentSnapshot,
  poll: PollNodeSpec,
  now: Date,
): boolean {
  if (!poll.closesBind || !poll.closesBind.startsWith("content.fields.")) {
    return false;
  }
  const value =
    document.content.fields[poll.closesBind.slice("content.fields.".length)];
  if (typeof value !== "string" || value.trim() === "") return false;
  const closes = new Date(value);
  if (Number.isNaN(closes.getTime())) return false;
  return closes.getTime() < now.getTime();
}

/** Null when the submission is acceptable, otherwise a reader-safe reason. */
export function validatePollSubmission({
  labels,
  values,
  multiple,
}: {
  labels: string[];
  values: string[];
  multiple: boolean;
}): string | null {
  if (labels.length === 0) return "This poll has no options yet.";
  if (values.length === 0) return "Pick at least one option.";
  if (!multiple && values.length > 1) return "This poll accepts one choice.";
  if (new Set(values).size !== values.length) return "Duplicate choices.";
  for (const value of values) {
    if (!labels.includes(value)) return "That option is not on this poll.";
  }
  return null;
}

export type PollAggregate = {
  total: number;
  counts: Record<string, number>;
  viewer: string[] | null;
};
