export const POST_SLUG_MAX_LENGTH = 80;

function normalizedPostSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, POST_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

/**
 * The single route-slug policy for posts. Only lowercase ASCII letters,
 * numbers, and interior hyphens survive, so path/query delimiters, controls,
 * encoded separators, and oversized input can never become raw route state.
 */
export function sanitizePostSlug(value: string, fallback = "post"): string {
  return normalizedPostSlug(value) || normalizedPostSlug(fallback);
}

export function isSafePostSlug(value: string): boolean {
  return value.length > 0 && sanitizePostSlug(value, "") === value;
}

type SlugCandidate = {
  slug: string;
  slugHistory: readonly string[];
  deletedAt: Date | string | null;
};

/**
 * Build the bulk form of slug resolution for callers that already hold a
 * tenant snapshot. Live current slugs resolve to themselves, and a historical
 * slug resolves only when exactly one live row owns it. Any current slug,
 * including one held by a trashed row, blocks historical reuse.
 */
export function resolvableSlugAliases<T extends SlugCandidate>(
  rows: readonly T[],
): Record<string, string> {
  const currentSlugs = new Set(rows.map((row) => row.slug));
  const historicalOwners = new Map<string, Set<string>>();
  const aliases: Record<string, string> = {};

  for (const row of rows) {
    if (row.deletedAt != null) continue;
    aliases[row.slug] = row.slug;
    for (const alias of row.slugHistory) {
      const owners = historicalOwners.get(alias) ?? new Set<string>();
      owners.add(row.slug);
      historicalOwners.set(alias, owners);
    }
  }

  for (const [alias, owners] of historicalOwners) {
    if (currentSlugs.has(alias) || owners.size !== 1) continue;
    aliases[alias] = [...owners][0]!;
  }
  return aliases;
}

type SlugCandidateResolution<T extends SlugCandidate> =
  | { kind: "exact"; row: T }
  | { kind: "history"; row: T }
  | { kind: "tombstone" }
  | { kind: "ambiguous" }
  | { kind: "missing" };

/**
 * Resolve all rows returned by one tenant-scoped database snapshot.
 *
 * A live exact slug always wins. A trashed exact row is a tombstone until it
 * is reclaimed or permanently deleted, so an old historical owner cannot
 * unexpectedly reappear at that URL. Historical aliases redirect only when
 * exactly one live post owns the alias; ambiguity fails closed.
 */
export function classifySlugCandidates<T extends SlugCandidate>(
  requestedSlug: string,
  rows: readonly T[],
): SlugCandidateResolution<T> {
  const exact = rows.filter((row) => row.slug === requestedSlug);
  const liveExact = exact.find((row) => row.deletedAt == null);
  if (liveExact) return { kind: "exact", row: liveExact };
  if (exact.length > 0) return { kind: "tombstone" };

  const historical = rows.filter(
    (row) =>
      row.deletedAt == null && row.slugHistory.includes(requestedSlug),
  );
  if (historical.length === 1) {
    return { kind: "history", row: historical[0] };
  }
  if (historical.length > 1) return { kind: "ambiguous" };
  return { kind: "missing" };
}
