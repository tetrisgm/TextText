import { htmlToMarkdown } from "./html-to-markdown";

const MIN_ARTICLE_CHARS = 200;

const NEVER_ARTICLE = ["script", "style", "noscript", "template", "svg", "nav", "footer", "aside", "header", "form", "iframe", "button", "select", "menu", "dialog"];

function cutRegions(html: string, tags: string[]): string {
  let out = html;
  for (const tag of tags) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), " ");
  }
  return out.replace(/<!--[\s\S]*?-->/g, " ");
}

function textOf(fragment: string): string {
  return fragment.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The article's HTML, or null when the page does not read as one. Prefers
 * an <article> or <main> when the page marks one and it carries real text;
 * otherwise takes every paragraph and heading with enough words, in order.
 */
export function extractArticleHtml(html: string): string | null {
  const cleaned = cutRegions(html, NEVER_ARTICLE);
  const marked =
    cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i)?.[1] ??
    cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1] ??
    null;
  const source = marked && textOf(marked).length >= MIN_ARTICLE_CHARS ? marked : cleaned;
  const blocks = [...source.matchAll(/<(p|h1|h2|h3|h4|blockquote|pre|ul|ol|figure)\b[^>]*>[\s\S]*?<\/\1\s*>/gi)]
    .map((match) => match[0])
    .filter((block) => {
      const text = textOf(block);
      if (/^<(h[1-4]|figure|pre)/i.test(block)) return text.length > 0;
      return text.length >= 40 && text.split(" ").length >= 6;
    });
  if (blocks.length === 0) return null;
  const joined = blocks.join("\n");
  return textOf(joined).length >= MIN_ARTICLE_CHARS ? joined : null;
}

export function extractArticleMarkdown(html: string): string | null {
  const article = extractArticleHtml(html);
  if (!article) return null;
  const markdown = htmlToMarkdown(article).markdown.trim();
  return markdown.length >= MIN_ARTICLE_CHARS ? markdown : null;
}

