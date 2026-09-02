import type { Post } from "@/lib/content";

/**
 * H6 is reserved for TextText's subtitle block. The editor only exposes H1-H3 as
 * headings, so the representation stays valid Markdown without colliding with
 * an authored block type.
 */
const SUBTITLE_MARKDOWN_MARKER = "######";

type SubtitleLine = {
  end: number;
  markdown: string;
  start: number;
};

function subtitleLine(markdown: string): SubtitleLine | null {
  // Walk lines with indexOf and stop at the first non-blank one. This runs on
  // every draft merge and pool build; regex-splitting the entire body first
  // made it O(document) per call, which at multi-megabyte bodies dominated a
  // typing burst's allocations.
  let offset = 0;
  const length = markdown.length;
  while (offset < length) {
    const newline = markdown.indexOf("\n", offset);
    const entryEnd = newline === -1 ? length : newline + 1;
    let contentEnd = newline === -1 ? length : newline;
    if (contentEnd > offset && markdown.charCodeAt(contentEnd - 1) === 13) {
      contentEnd -= 1;
    }
    const line = markdown.slice(offset, contentEnd);
    // Skip leading blank lines: the subtitle must be the FIRST content block.
    if (line.trim() === "") {
      offset = entryEnd;
      continue;
    }
    // The first non-blank block decides. A leading H6 is the subtitle; anything
    // else (body text, a code fence, a real heading, a list) means there is no
    // leading subtitle. This is what keeps a genuine mid-body "###### Heading"
    // (e.g. from imported markdown) from being hijacked as the document's
    // subtitle/dek/meta and overwriting the real excerpt on save.
    const match = /^ {0,3}######(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (match) {
      return {
        start: offset,
        end: entryEnd,
        markdown: (match[1] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim(),
      };
    }
    return null;
  }

  return null;
}

function inlineMarkdownToText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\\([\\`*{}\[\]()#+\-.!_>~])/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeInlineMarkdown(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([\\`*{}\[\]()#+\-.!_>~])/g, "\\$1");
}

export function markdownSubtitle(markdown: string | undefined): string {
  if (!markdown) return "";
  const line = subtitleLine(markdown);
  return line ? inlineMarkdownToText(line.markdown) : "";
}

export function hasMarkdownSubtitle(markdown: string | undefined): boolean {
  return Boolean(markdown && subtitleLine(markdown));
}

export function ensureMarkdownSubtitle(
  markdown: string,
  legacyExcerpt?: string,
  ensureEmpty = false,
): string {
  if (hasMarkdownSubtitle(markdown)) return markdown;
  const subtitle = escapeInlineMarkdown(legacyExcerpt ?? "");
  if (!subtitle && !ensureEmpty) return markdown;
  const block = subtitle ? `${SUBTITLE_MARKDOWN_MARKER} ${subtitle}` : SUBTITLE_MARKDOWN_MARKER;
  return markdown ? `${block}\n\n${markdown}` : block;
}

/** Replace the typed subtitle from a plain-text surface such as an agent tool. */
export function replaceMarkdownSubtitle(
  markdown: string,
  subtitle: string,
): string {
  const current = subtitleLine(markdown);
  const nextSubtitle = escapeInlineMarkdown(subtitle);
  const nextLine = nextSubtitle
    ? `${SUBTITLE_MARKDOWN_MARKER} ${nextSubtitle}\n`
    : "";

  if (current) {
    const next = `${markdown.slice(0, current.start)}${nextLine}${markdown.slice(current.end)}`;
    return next.replace(/^\r?\n+/, "");
  }
  if (!nextSubtitle) return markdown;
  return markdown ? `${nextLine}\n${markdown}` : nextLine.trimEnd();
}

export function postSubtitle(
  post: Pick<Post, "body" | "excerpt">,
): string {
  return markdownSubtitle(post.body) || post.excerpt?.trim() || "";
}

/** Materialize an old excerpt as the first body block for readers and files. */
export function postBodyWithSubtitle(
  post: Pick<Post, "body" | "excerpt">,
): string {
  return ensureMarkdownSubtitle(post.body, post.excerpt);
}
