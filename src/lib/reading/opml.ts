import { XMLParser } from "fast-xml-parser";

/**
 * OPML in and out. Import reads only what a subscription list carries
 * (feed address, title, site) and refuses documents with declarations, the
 * same rule the feed parser applies. Export writes the workspace's sources
 * grouped by their parent folder, so a list round-trips into the same shape.
 */

export type OpmlEntry = { xmlUrl: string; title: string | null; htmlUrl: string | null; folder: string | null };

const MAX_ENTRIES = 500;

/** Only the five XML entities; processEntities is off so nothing else expands. */
function decodeXml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, name: string) =>
    name === "amp" ? "&" : name === "lt" ? "<" : name === "gt" ? ">" : name === "quot" ? '"' : "'",
  );
}

function attribute(outline: Record<string, unknown>, name: string): string | null {
  const value = outline[`@_${name}`];
  return typeof value === "string" && value.trim() ? decodeXml(value.trim()) : null;
}

export function parseOpml(text: string): OpmlEntry[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("OPML with document type declarations is not accepted");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    processEntities: false,
    allowBooleanAttributes: true,
    isArray: (name) => name === "outline",
  });
  let document: unknown;
  try {
    document = parser.parse(text);
  } catch {
    throw new Error("That is not readable OPML");
  }
  const body = (document as { opml?: { body?: { outline?: unknown[] } } })?.opml?.body;
  if (!body) throw new Error("That is not an OPML subscription list");
  const entries: OpmlEntry[] = [];
  const seen = new Set<string>();
  const walk = (outlines: unknown[], folder: string | null) => {
    for (const raw of outlines) {
      if (entries.length >= MAX_ENTRIES) return;
      const outline = raw as Record<string, unknown>;
      const xmlUrl = attribute(outline, "xmlUrl") ?? "";
      const title = attribute(outline, "title") ?? attribute(outline, "text");
      if (xmlUrl && /^https?:\/\//i.test(xmlUrl)) {
        if (!seen.has(xmlUrl)) {
          seen.add(xmlUrl);
          entries.push({ xmlUrl, title, htmlUrl: attribute(outline, "htmlUrl"), folder });
        }
      } else if (Array.isArray(outline.outline)) {
        walk(outline.outline, title);
      }
    }
  };
  walk(Array.isArray(body.outline) ? body.outline : [], null);
  return entries;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildOpml(input: {
  title: string;
  sources: Array<{ title: string; xmlUrl: string; htmlUrl: string | null; folder: string }>;
}): string {
  const byFolder = new Map<string, typeof input.sources>();
  for (const source of input.sources) byFolder.set(source.folder, [...(byFolder.get(source.folder) ?? []), source]);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    `  <head><title>${escapeAttribute(input.title)}</title></head>`,
    "  <body>",
  ];
  for (const [folder, sources] of byFolder) {
    lines.push(`    <outline text="${escapeAttribute(folder)}" title="${escapeAttribute(folder)}">`);
    for (const source of sources) {
      lines.push(
        `      <outline type="rss" text="${escapeAttribute(source.title)}" title="${escapeAttribute(source.title)}" xmlUrl="${escapeAttribute(source.xmlUrl)}"${
          source.htmlUrl ? ` htmlUrl="${escapeAttribute(source.htmlUrl)}"` : ""
        } />`,
      );
    }
    lines.push("    </outline>");
  }
  lines.push("  </body>", "</opml>", "");
  return lines.join("\n");
}
