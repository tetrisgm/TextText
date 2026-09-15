/**
 * Publisher HTML to the Markdown an item body holds.
 *
 * This is deliberately a small allowlisting converter, not a general HTML
 * engine. Feeds are untrusted input; what survives is paragraphs, headings,
 * emphasis, lists, quotes, code, links to http(s) and images by http(s) URL.
 * Everything else is dropped or reduced to its text: scripts, styles, frames,
 * forms, event handlers, data: and javascript: URLs, and any tag not in the
 * list. Nothing here can put markup into the renderer, which parses Markdown
 * with no raw-HTML pass (DocumentRenderer, no rehype-raw).
 */

/** Content of these is discarded entirely, not just their tags. */
const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "noscript",
  "template",
  "svg",
  "math",
  "video",
  "audio",
  "canvas",
  "head",
  "title",
]);

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,12});/g,
    (whole, body: string) => {
      if (body[0] === "#") {
        const code =
          body[1] === "x" || body[1] === "X"
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
        // Control characters and surrogates are not text.
        if (code < 0x20 && code !== 0x9 && code !== 0xa && code !== 0xd) return "";
        if (code >= 0xd800 && code <= 0xdfff) return "";
        return String.fromCodePoint(code);
      }
      const named = ENTITIES[body];
      return named ?? whole;
    },
  );
}

function safeHref(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = decodeHtmlEntities(raw).trim();
  if (!/^https?:\/\//i.test(value)) return null;
  if (/[\s<>"']/.test(value)) return null;
  if (value.length > 2048) return null;
  return value;
}

function attribute(attrs: string, name: string): string | undefined {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    "i",
  ).exec(attrs);
  if (!match) return undefined;
  return match[1] ?? match[2] ?? match[3];
}

type Token =
  | { kind: "text"; value: string }
  | { kind: "open"; tag: string; attrs: string; selfClosing: boolean }
  | { kind: "close"; tag: string };

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*?)?)(\/?)>|<[^>]*>/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    if (match.index > last) {
      tokens.push({ kind: "text", value: html.slice(last, match.index) });
    }
    last = pattern.lastIndex;
    const raw = match[0];
    if (raw.startsWith("<!--") || raw.startsWith("<![CDATA[") ) continue;
    if (match[1]) {
      tokens.push({ kind: "close", tag: match[1].toLowerCase() });
    } else if (match[2]) {
      tokens.push({
        kind: "open",
        tag: match[2].toLowerCase(),
        attrs: match[3] ?? "",
        selfClosing: match[4] === "/",
      });
    }
    // Any other "<...>" (doctype, processing instruction, junk) is dropped.
  }
  if (last < html.length) {
    const tail = html.slice(last);
    const dangling = /<[a-zA-Z!/?][^<]*$/.exec(tail);
    const value = dangling ? tail.slice(0, dangling.index) : tail;
    if (value) tokens.push({ kind: "text", value });
  }
  return tokens;
}

function escapeMarkdownText(text: string): string {
  // Only the characters that would otherwise start Markdown structure at a
  // line start or wrap emphasis. Over-escaping makes publisher prose unreadable.
  // A "<" that begins something tag-shaped is turned into its entity: the
  // renderer has no raw-HTML pass, but the body should not carry markup
  // either, and an unterminated tag at the end of a truncated feed is the
  // usual way one arrives.
  return text
    .replace(/([\\`*_[\]#])/g, "\\$1")
    .replace(/<(?=[a-zA-Z/!?])/g, "&lt;");
}

export type HtmlToMarkdownResult = {
  markdown: string;
  /** Plain text with markup removed, for hashing and search. */
  text: string;
  /** Number of images kept, so a caller can decide on asset handling. */
  imageCount: number;
};

/**
 * Convert publisher HTML to Markdown. Whitespace is collapsed the way a
 * browser would inside blocks; block boundaries become blank lines. Nested
 * lists are indented; other nesting is flattened to keep the output honest
 * rather than clever.
 */
export function htmlToMarkdown(html: string): HtmlToMarkdownResult {
  const out: string[] = [];
  let imageCount = 0;
  const listStack: Array<{ ordered: boolean; index: number }> = [];
  let dropDepth = 0;
  let preDepth = 0;
  let linkHref: string | null = null;
  let linkText: string[] = [];
  let pendingBlank = false;
  let atLineStart = true;

  const write = (text: string) => {
    if (!text) return;
    if (pendingBlank) {
      out.push("\n\n");
      pendingBlank = false;
      atLineStart = true;
    }
    if (linkHref !== null) {
      linkText.push(text);
      return;
    }
    out.push(text);
    atLineStart = text.endsWith("\n");
  };
  const blockBoundary = () => {
    if (out.length === 0) return;
    pendingBlank = true;
  };
  const flushBlank = () => {
    if (!pendingBlank) return;
    out.push("\n\n");
    pendingBlank = false;
    atLineStart = true;
  };
  // A blockquote is assembled after its content: every line of what its
  // children wrote is prefixed on close, so paragraphs inside it stay inside.
  const quoteStack: number[] = [];
  const inlineText = (raw: string) => {
    if (dropDepth > 0) return;
    const decoded = decodeHtmlEntities(raw);
    if (preDepth > 0) {
      write(decoded);
      return;
    }
    const collapsed = decoded.replace(/\s+/g, " ");
    if (!collapsed.trim()) {
      if (!atLineStart && collapsed && !pendingBlank) write(" ");
      return;
    }
    write(
      atLineStart
        ? escapeMarkdownText(collapsed.replace(/^\s+/, ""))
        : escapeMarkdownText(collapsed),
    );
  };

  const tokens = tokenize(html);
  for (const token of tokens) {
    if (token.kind === "text") {
      inlineText(token.value);
      continue;
    }
    const tag = token.kind === "open" ? token.tag : token.tag;
    if (DROP_WITH_CONTENT.has(tag)) {
      if (token.kind === "open" && !token.selfClosing) dropDepth += 1;
      else if (token.kind === "close" && dropDepth > 0) dropDepth -= 1;
      continue;
    }
    if (dropDepth > 0) continue;

    if (token.kind === "open") {
      switch (tag) {
        case "h1":
        case "h2":
        case "h3":
        case "h4":
        case "h5":
        case "h6": {
          blockBoundary();
          const level = Math.min(6, Math.max(2, Number(tag[1])));
          write(`${"#".repeat(level)} `);
          break;
        }
        case "p":
        case "div":
        case "section":
        case "article":
        case "header":
        case "footer":
        case "main":
        case "aside":
        case "figure":
        case "figcaption":
        case "table":
        case "tr":
        case "dl":
        case "dt":
        case "dd":
          blockBoundary();
          break;
        case "br":
          write("  \n");
          break;
        case "hr":
          blockBoundary();
          write("---");
          blockBoundary();
          break;
        case "ul":
        case "ol":
          // A list nested inside an item continues that item; a blank line
          // there would split the list in Markdown.
          if (listStack.length === 0) blockBoundary();
          else if (!atLineStart) write("\n");
          listStack.push({ ordered: tag === "ol", index: 0 });
          break;
        case "li": {
          const list = listStack[listStack.length - 1];
          // The first item of a list keeps the blank line that separates the
          // list from what came before; later items must not, or the list
          // splits.
          if (list && list.index === 0) flushBlank();
          else pendingBlank = false;
          if (out.length > 0 && !atLineStart) write("\n");
          const indent = "  ".repeat(Math.max(0, listStack.length - 1));
          if (list?.ordered) {
            list.index += 1;
            write(`${indent}${list.index}. `);
          } else {
            write(`${indent}- `);
          }
          break;
        }
        case "blockquote":
          blockBoundary();
          flushBlank();
          quoteStack.push(out.length);
          break;
        case "pre":
          blockBoundary();
          write("```\n");
          preDepth += 1;
          break;
        case "code":
          if (preDepth === 0) write("`");
          break;
        case "strong":
        case "b":
          write("**");
          break;
        case "em":
        case "i":
          write("_");
          break;
        case "a": {
          const href = safeHref(attribute(token.attrs, "href"));
          if (href && linkHref === null) {
            linkHref = href;
            linkText = [];
          }
          break;
        }
        case "img": {
          const src = safeHref(attribute(token.attrs, "src"));
          if (src) {
            imageCount += 1;
            const alt = decodeHtmlEntities(attribute(token.attrs, "alt") ?? "")
              .replace(/[\[\]]/g, "")
              .trim();
            write(`![${alt}](${src})`);
          }
          break;
        }
        default:
          break;
      }
      if (token.selfClosing && (tag === "ul" || tag === "ol")) listStack.pop();
      continue;
    }

    switch (tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
      case "p":
      case "div":
      case "section":
      case "article":
      case "header":
      case "footer":
      case "main":
      case "aside":
      case "figure":
      case "figcaption":
      case "table":
      case "tr":
      case "dl":
      case "dt":
      case "dd":
        blockBoundary();
        break;
      case "blockquote": {
        const start = quoteStack.pop();
        if (start !== undefined) {
          const inner = out.splice(start).join("").replace(/\n{3,}/g, "\n\n").trim();
          if (inner) {
            out.push(
              inner
                .split("\n")
                .map((line) => (line ? `> ${line}` : ">"))
                .join("\n"),
            );
            atLineStart = false;
          }
        }
        blockBoundary();
        break;
      }
      case "li":
        if (!atLineStart) write("\n");
        pendingBlank = false;
        break;
      case "ul":
      case "ol":
        listStack.pop();
        if (listStack.length === 0) blockBoundary();
        else if (!atLineStart) write("\n");
        break;
      case "pre":
        if (preDepth > 0) preDepth -= 1;
        if (!atLineStart) write("\n");
        write("```");
        blockBoundary();
        break;
      case "code":
        if (preDepth === 0) write("`");
        break;
      case "strong":
      case "b":
        write("**");
        break;
      case "em":
      case "i":
        write("_");
        break;
      case "a": {
        if (linkHref !== null) {
          const href = linkHref;
          const text = linkText.join("").trim() || href;
          linkHref = null;
          linkText = [];
          write(`[${text}](${href})`);
        }
        break;
      }
      default:
        break;
    }
  }
  if (linkHref !== null) {
    const href = linkHref;
    linkHref = null;
    write(`[${linkText.join("").trim() || href}](${href})`);
  }

  const markdown = out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { markdown, text, imageCount };
}

/** Plain text only: what a headline or an excerpt should be. */
export function htmlToText(html: string): string {
  return htmlToMarkdown(html).text;
}
