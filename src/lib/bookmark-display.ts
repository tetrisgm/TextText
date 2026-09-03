// Display-time cleanup for bookmark readable bodies.
//
// A capture agent's readable markdown usually opens with the page repeating
// itself: its own title as a heading, the meta description as the first
// paragraph, the bare site name or domain on a line. The bookmark masthead
// already shows title, description, and source link, so those opening blocks
// read as stutter. This strips ONLY leading blocks that duplicate what the
// masthead shows, by normalized comparison - it never touches anything past
// the first block that carries its own information.

function normalizeForMatch(value: string): string {
  return value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>#]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/[.…]+$/g, "")
    .trim()
    .toLowerCase();
}

export function stripRedundantBookmarkLead(
  body: string,
  masthead: {
    title?: string;
    excerpt?: string;
    sourceUrl?: string;
    siteName?: string;
  },
): string {
  if (!body.trim()) return body;
  const known = new Set<string>();
  const add = (value: string | undefined) => {
    const normalized = normalizeForMatch(value ?? "");
    if (normalized) known.add(normalized);
  };
  add(masthead.title);
  add(masthead.excerpt);
  add(masthead.siteName);
  if (masthead.sourceUrl) {
    try {
      const url = new URL(masthead.sourceUrl);
      add(url.hostname);
      add(url.hostname.replace(/^www\./, ""));
    } catch {
      /* not a URL */
    }
  }
  if (known.size === 0) return body;

  const blocks = body.split(/\n{2,}/);
  let index = 0;
  const matchesMasthead = (block: string): boolean => {
    const normalized = normalizeForMatch(block);
    if (!normalized || normalized.length > 400) return false;
    for (const candidate of known) {
      if (normalized === candidate) return true;
      // The auto-excerpt is a truncation of the page description; the body
      // carries the full paragraph. Treat a block that starts with the
      // truncated excerpt (sans ellipsis) as the same paragraph.
      if (
        candidate.length >= 60 &&
        (normalized.startsWith(candidate) || candidate.startsWith(normalized))
      ) {
        return true;
      }
    }
    return false;
  };
  // Only the opening run, and never more than the first four blocks.
  while (index < Math.min(blocks.length, 4) && matchesMasthead(blocks[index])) {
    index += 1;
  }
  if (index === 0) return body;
  return blocks.slice(index).join("\n\n").trimStart();
}
