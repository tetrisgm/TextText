import { exemplarFor } from "@/lib/presentation/exemplars";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import type { DocumentFieldDefinition, TemplateDefinition } from "@/lib/presentation/schema";

/**
 * Worked examples for the item type designer.
 *
 * The model had none. It designed from a schema description alone, and the
 * results showed it: a request for a running log with a year grid produced a
 * type with no fields at all, and the same brief run twice produced different
 * field labels each time. Meanwhile 11 active built-in templates and 28
 * documents written to genre standard sat in the repo, read by the showcase
 * and the gallery and by nothing in the AI path.
 *
 * Closeness, not everything: handing over all eleven would swamp the request
 * and teach the model to average. Two nearby ones teach what a good field set
 * for this KIND of thing looks like, which is the judgement it was missing.
 * When nothing is close, the honest answer is no example at all.
 */

const STOP = new Set([
  "a", "an", "the", "my", "me", "i", "it", "its", "and", "or", "of", "for", "to",
  "in", "on", "with", "that", "this", "make", "want", "like", "into", "so", "can",
  "see", "show", "give", "let", "each", "every", "some", "all", "is", "are", "be",
  "have", "has", "keep", "look", "looks", "new", "one", "them", "they", "their",
  "where", "what", "when", "how", "please", "would", "should", "need", "needs",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

/** Singular and plural collapse, so "recipes" matches "recipe". */
function stem(word: string): string {
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) return word.slice(0, -1);
  return word;
}

/**
 * Weighted, because raw overlap rewards whichever template has the most prose
 * attached to it. An incidental word in a long exemplar body once put Article
 * ahead of every genre-specific answer.
 */
function weightedWords(template: TemplateDefinition): Map<string, number> {
  const exemplar = exemplarFor(template.id);
  const parts: Array<[string, number]> = [
    [template.name, 4],
    [template.description ?? "", 2],
    [template.fields.map((field) => field.label).join(" "), 2],
    [template.collection.layout, 1],
    [exemplar?.title ?? "", 2],
    // The opening of a real document says more about the genre than its title,
    // but it is also the noisiest thing here, so it counts least.
    [(exemplar?.body ?? "").slice(0, 400), 1],
  ];
  const weights = new Map<string, number>();
  for (const [text, weight] of parts) {
    for (const word of tokens(text).map(stem)) {
      weights.set(word, Math.max(weights.get(word) ?? 0, weight));
    }
  }
  return weights;
}

/** One incidental word is not a genre match. Two weak ones, or one strong, is. */
const MIN_SCORE = 3;

export type ScoredExample = { template: TemplateDefinition; score: number };

/**
 * Rank the ACTIVE built-ins by how much of the request's vocabulary they use.
 *
 * Active only, deliberately. Eighteen further templates exist in the file and
 * are kept resolvable so documents pinned to them still render, but they were
 * retired from the catalogue at the owner's request. Showing them to the model
 * would teach it to design like the things that were taken away.
 */
export function rankItemTypeExamples(request: string): ScoredExample[] {
  const wanted = new Set(tokens(request).map(stem));
  if (!wanted.size) return [];
  return BUILTIN_TEMPLATES.map((template) => {
    const weights = weightedWords(template);
    let score = 0;
    for (const word of wanted) score += weights.get(word) ?? 0;
    return { template, score };
  })
    .filter((entry) => entry.score >= MIN_SCORE)
    .sort((a, b) =>
      b.score - a.score || a.template.id.localeCompare(b.template.id),
    );
}

function describeField(field: DocumentFieldDefinition): string {
  if (field.type === "rows") {
    const sub = field.fields.map((entry) => entry.id).join(", ");
    return `${field.id} (rows of ${sub})`;
  }
  if (field.type === "enum") {
    const options = field.options.map((option) => option.value).slice(0, 5).join("/");
    return `${field.id} (enum: ${options})`;
  }
  return `${field.id} (${field.type})`;
}

function renderExample(template: TemplateDefinition): string {
  const exemplar = exemplarFor(template.id);
  const lines = [
    `Example: ${template.name}`,
    template.description ? `What it is for: ${template.description}` : "",
    `Fields: ${template.fields.map(describeField).join(", ") || "none beyond title and body"}`,
    `Folder view: ${template.collection.layout}`,
  ];
  if (exemplar) {
    const opening = exemplar.body.split("\n").filter(Boolean).slice(0, 2).join(" ");
    lines.push(`A real one reads: "${exemplar.title}" - ${opening.slice(0, 220)}`);
  }
  return lines.filter(Boolean).join("\n");
}

/**
 * The block handed to the model, or "" when nothing is close enough. An empty
 * string is a valid answer: a request unlike anything built in is better served
 * by the rules alone than by a misleading neighbour.
 */
export function itemTypeExamplesFor(request: string, limit = 2): string {
  const ranked = rankItemTypeExamples(request).slice(0, limit);
  if (!ranked.length) return "";
  return [
    "Item types that already exist here, for reference. Do not copy them.",
    "Notice how few fields each one has, and that every field is one a person",
    "would actually fill in. Design to that standard for the request at hand.",
    "",
    ranked.map((entry) => renderExample(entry.template)).join("\n\n"),
  ].join("\n");
}
