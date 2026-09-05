import { z } from "zod";

export const MAX_SELECTION_CHARS = 4_000;
export const SELECTION_BUDGET_ERROR =
  "Select up to 4,000 characters and try again. Nothing changed.";
export const SELECTION_STALE_ERROR =
  "This passage changed or is not saved yet. Select it again after saving. Nothing changed.";
export const SELECTION_INVALID_ERROR =
  "This selection could not be verified. Select it again. Nothing changed.";

// Offsets and the budget use UTF-16 code units, just like textarea selections.
export const selectionEnvelopeSchema = z.object({
  itemId: z.string().min(1).max(128),
  field: z.enum(["title", "excerpt", "body"]),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  start: z.number().int().nonnegative().max(1_000_000),
  end: z.number().int().positive().max(1_000_000),
  text: z.string().min(1).max(MAX_SELECTION_CHARS),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine((value) => value.end - value.start === value.text.length);

export type SelectionEnvelope = z.infer<typeof selectionEnvelopeSchema>;
type Selection = Pick<SelectionEnvelope, "field" | "start" | "end" | "text">;
type ItemText = {
  revision?: number;
  title: string;
  excerpt?: string | null;
  body: string;
};

export function parseSelectionEnvelope(value: unknown): SelectionEnvelope {
  if (value && typeof value === "object" && "text" in value &&
      typeof value.text === "string" && value.text.length > MAX_SELECTION_CHARS) {
    throw new Error(SELECTION_BUDGET_ERROR);
  }
  const parsed = selectionEnvelopeSchema.safeParse(value);
  if (!parsed.success) throw new Error(SELECTION_INVALID_ERROR);
  return parsed.data;
}

async function selectionHash(value: Omit<SelectionEnvelope, "hash">): Promise<string> {
  // Bind the entire envelope, not just the text. This is an integrity check,
  // not an authorization token; document access is still checked separately.
  const bytes = new TextEncoder().encode(JSON.stringify([
    value.itemId, value.field, value.revision, value.start, value.end, value.text,
  ]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function validateSelectionEnvelope(value: unknown): Promise<SelectionEnvelope> {
  const envelope = parseSelectionEnvelope(value);
  if (await selectionHash(envelope) !== envelope.hash) throw new Error(SELECTION_INVALID_ERROR);
  return envelope;
}

export function assertSelectionMatches(
  envelope: SelectionEnvelope,
  itemId: string,
  item: ItemText,
): void {
  if (envelope.itemId !== itemId || envelope.revision !== item.revision ||
      (item[envelope.field] ?? "").slice(envelope.start, envelope.end) !== envelope.text) {
    throw new Error(SELECTION_STALE_ERROR);
  }
}

export async function createSelectionEnvelope(
  itemId: string,
  item: ItemText,
  selection: Selection | null,
): Promise<SelectionEnvelope | undefined> {
  if (!selection) return undefined;
  if (selection.text.length > MAX_SELECTION_CHARS) throw new Error(SELECTION_BUDGET_ERROR);
  if (!Number.isSafeInteger(item.revision) || item.revision! < 0) throw new Error(SELECTION_STALE_ERROR);
  const value = { ...selection, itemId, revision: item.revision! };
  const envelope = parseSelectionEnvelope({ ...value, hash: await selectionHash(value) });
  assertSelectionMatches(envelope, itemId, item);
  return envelope;
}

/** Validate a persisted proposal against both its target edit and today's item. */
export async function validateSelectionEditEnvelope(
  value: unknown,
  itemId: string,
  item: ItemText,
  edit: { field: SelectionEnvelope["field"]; start: number; end: number; text: string },
): Promise<SelectionEnvelope> {
  const envelope = await validateSelectionEnvelope(value);
  assertSelectionMatches(envelope, itemId, item);
  if (envelope.field !== edit.field || envelope.start !== edit.start ||
      envelope.end !== edit.end || envelope.text !== edit.text) {
    throw new Error(SELECTION_INVALID_ERROR);
  }
  return envelope;
}
