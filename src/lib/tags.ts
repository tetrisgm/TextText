export const MAX_TAGS = 24;
export const MAX_TAG_LENGTH = 48;

/**
 * Canonical tag storage for every surface. A top-level string may be a
 * hand-written comma list; array entries are treated as individual tags.
 */
export function normalizeTags(raw: unknown): string[] {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") continue;
    const tag = value
      .trim()
      .replace(/^#+/, "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase()
      .slice(0, MAX_TAG_LENGTH)
      .trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }

  return tags;
}

export function normalizeTag(raw: unknown): string | null {
  return normalizeTags(typeof raw === "string" ? [raw] : raw)[0] ?? null;
}
