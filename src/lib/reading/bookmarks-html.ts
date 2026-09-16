/**
 * Netscape bookmark files: what browsers, Pinboard, Instapaper, Pocket, and
 * Raindrop export. Import reads links with their titles, dates, tags, and
 * the folder they sat in; export writes the workspace's saved bookmarks in
 * the same shape so they round-trip.
 */

export type HtmlBookmark = { url: string; title: string; addedAt: Date | null; tags: string[]; folder: string | null; description: string | null };

const MAX_LINKS = 2000;

function decode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i")) ?? tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i"));
  return match ? decode(match[1]) : null;
}

export function parseBookmarksHtml(html: string): HtmlBookmark[] {
  if (/<!ENTITY/i.test(html)) throw new Error("Bookmark files with entity declarations are not accepted");
  const bookmarks: HtmlBookmark[] = [];
  const folders: string[] = [];
  // One pass over the tokens that carry meaning: folder headings open a
  // folder, </DL> closes one, <A> is a bookmark, <DD> after it a description.
  const tokens = html.matchAll(/<H3\b[^>]*>([\s\S]*?)<\/H3>|<\/DL>|<A\b([^>]*)>([\s\S]*?)<\/A>|<DD>([\s\S]*?)(?=<DT>|<\/DL>|<DD>|$)/gi);
  for (const token of tokens) {
    if (bookmarks.length >= MAX_LINKS) break;
    const [whole, heading, anchorAttributes, anchorText, description] = token;
    if (heading !== undefined) {
      folders.push(decode(heading.replace(/<[^>]+>/g, "")).trim());
    } else if (/^<\/DL>/i.test(whole)) {
      folders.pop();
    } else if (anchorAttributes !== undefined) {
      const url = attribute(anchorAttributes, "href")?.trim() ?? "";
      if (!/^https?:\/\//i.test(url)) continue;
      const added = attribute(anchorAttributes, "add_date");
      const seconds = added && /^\d+$/.test(added) ? Number(added) : null;
      bookmarks.push({
        url,
        title: decode(anchorText.replace(/<[^>]+>/g, "")).trim() || url,
        addedAt: seconds ? new Date(seconds > 1e12 ? seconds : seconds * 1000) : null,
        tags: (attribute(anchorAttributes, "tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
        folder: folders.length ? folders.join("/") : null,
        description: null,
      });
    } else if (description !== undefined && bookmarks.length > 0) {
      const last = bookmarks[bookmarks.length - 1];
      if (last.description === null) last.description = decode(description.replace(/<[^>]+>/g, "")).trim() || null;
    }
  }
  return bookmarks;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildBookmarksHtml(input: {
  title: string;
  bookmarks: Array<{ url: string; title: string; addedAt: Date; tags: string[]; folder: string; description?: string | null }>;
}): string {
  const byFolder = new Map<string, typeof input.bookmarks>();
  for (const bookmark of input.bookmarks) byFolder.set(bookmark.folder, [...(byFolder.get(bookmark.folder) ?? []), bookmark]);
  const lines = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    `<TITLE>${escapeHtml(input.title)}</TITLE>`,
    `<H1>${escapeHtml(input.title)}</H1>`,
    "<DL><p>",
  ];
  for (const [folder, bookmarks] of byFolder) {
    lines.push(`    <DT><H3>${escapeHtml(folder)}</H3>`, "    <DL><p>");
    for (const bookmark of bookmarks) {
      const tags = bookmark.tags.length ? ` TAGS="${escapeHtml(bookmark.tags.join(","))}"` : "";
      lines.push(`        <DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${Math.floor(bookmark.addedAt.getTime() / 1000)}"${tags}>${escapeHtml(bookmark.title)}</A>`);
      if (bookmark.description) lines.push(`        <DD>${escapeHtml(bookmark.description)}`);
    }
    lines.push("    </DL><p>");
  }
  lines.push("</DL><p>", "");
  return lines.join("\n");
}
