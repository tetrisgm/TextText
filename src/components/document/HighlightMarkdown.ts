/**
 * `==highlighted==` in a document's Markdown, rendered as a real highlight.
 *
 * "Add some highlights on the important parts" is one of the things this
 * product is for, and there was no way to do it. The editor knows bold, italic
 * and code; the reader renders GFM, which has no highlight. So the assistant
 * either bolded things, which means something else, or invented HTML the
 * renderer refuses.
 *
 * Deliberately a Markdown convention rather than a new field or mark type. The
 * text stays text: it round trips through Yjs, the sync envelope, the exported
 * textpack and every other reader untouched, and an older build shows the
 * literal `==` rather than losing the emphasis. Nothing in the content model,
 * the collaboration path or the file format had to change to add it.
 *
 * The syntax is the one Obsidian and Bear already use, so a person who has
 * highlighted anything before will guess it right.
 *
 * A backslash does NOT escape it. Markdown strips the escape before any plugin
 * sees the text - `\==x==` and `==x==` arrive as the identical text node, with
 * nothing to tell them apart - so there is no way to fix that from here. To
 * write the characters themselves, use inline code: `` `==x==` ``, which this
 * skips. Verified rather than assumed: an earlier draft of this comment
 * described an escape mechanism that does not exist.
 */

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: Record<string, unknown>;
};

/**
 * Two equals signs, then anything but a newline, then two more.
 *
 * Non-greedy so `==a== and ==b==` is two highlights rather than one that
 * swallows the middle. Single-line so an unclosed `==` cannot run to the end of
 * the document and highlight the rest of someone's note.
 */
const HIGHLIGHT = /==(?!\s)([^\n=]|=(?!=))+?==/g;

function splitHighlights(text: string): MarkdownNode[] {
  const out: MarkdownNode[] = [];
  let last = 0;
  for (const match of text.matchAll(HIGHLIGHT)) {
    const start = match.index ?? 0;
    if (start > last) out.push({ type: "text", value: text.slice(last, start) });
    out.push({
      // Carried as emphasis so every downstream consumer that walks mdast sees
      // an ordinary inline node, with the rendered tag overridden to <mark>.
      type: "emphasis",
      data: {
        hName: "mark",
        hProperties: { className: "tt-mark" },
      },
      children: [{ type: "text", value: match[0].slice(2, -2) }],
    });
    last = start + match[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

export function remarkHighlight() {
  return function transform(tree: MarkdownNode) {
    const visit = (node: MarkdownNode) => {
      if (!node.children) return;
      // Not inside code: `==` in a code sample is a comparison operator, not
      // emphasis. Links ARE descended into, on purpose: "[the ==key== page]"
      // should highlight inside the link text, and a URL never reaches here as
      // a text node. An earlier version of this comment said links were
      // skipped, and they never were.
      if (node.type === "code" || node.type === "inlineCode") return;
      const children: MarkdownNode[] = [];
      for (const child of node.children) {
        if (child.type !== "text" || typeof child.value !== "string") {
          visit(child);
          children.push(child);
          continue;
        }
        if (!child.value.includes("==")) {
          children.push(child);
          continue;
        }
        children.push(...splitHighlights(child.value));
      }
      node.children = children;
    };
    visit(tree);
  };
}
