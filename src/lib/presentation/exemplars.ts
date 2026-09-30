// Active examples are the document.json entries in checked-in TextPacks.
// Retired looks keep their historical examples for existing pinned documents.

import type { DocumentAsset } from "@/lib/documents/model";
import { GENERATED_BUILTIN_PRESETS } from "./generated-builtin-presets";
import legacyExemplars from "./legacy-exemplars.json";

export type Exemplar = {
  template: string;
  title: string;
  body: string;
  fields: Record<string, unknown>;
  tags?: string[];
  assets?: DocumentAsset[];
};

const activeExemplars: Exemplar[] = GENERATED_BUILTIN_PRESETS
  // Timeline has a valid example TextPack, but did not have an exemplar in the
  // original showcase. Preserve exemplarFor's null result for that ID.
  .filter(({ template }) => template.id !== "texttext.timeline")
  .map(({ template, document }) => ({
    template: template.id,
    title: document.content.title,
    body: document.content.body,
    fields: document.content.fields,
    ...(document.content.tags.length ? { tags: document.content.tags } : {}),
    ...(document.content.assets.length ? { assets: document.content.assets } : {}),
  }));

const byId = new Map<string, Exemplar>([
  ...activeExemplars,
  ...(legacyExemplars as Exemplar[]),
].map((entry) => [entry.template, entry]));

// Keep the showcase's established order while drawing active content from the
// TextPacks and retired content from the legacy examples.
const exemplarOrder = [
  "texttext.article", "texttext.note", "texttext.casestudy", "texttext.page",
  "texttext.bookmark", "texttext.gallery", "texttext.talk", "texttext.todo",
  "texttext.meeting", "texttext.journal", "texttext.bookshelf", "texttext.watchlist",
  "texttext.recipe", "texttext.changelog", "texttext.decision", "texttext.wiki",
  "texttext.spec", "texttext.project", "texttext.brief", "texttext.goals",
  "texttext.postmortem", "texttext.retro", "texttext.calendar",
  "texttext.newsletter", "texttext.now", "texttext.prompts", "texttext.poll",
  "texttext.rsvp",
] as const;

export const EXEMPLARS: Exemplar[] = exemplarOrder.map((id) => {
  const exemplar = byId.get(id);
  if (!exemplar) throw new Error(`Missing exemplar for ${id}`);
  return exemplar;
});

export function exemplarFor(templateId: string): Exemplar | null {
  return byId.get(templateId) ?? null;
}
