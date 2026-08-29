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
 * A backslash escapes it: `\==x==` renders as literal `==x==`.
 *
 * That took two tries and both errors are worth keeping. The first version
 * described an escape mechanism that did not exist. The second checked that
 * Markdown strips the backslash before any plugin sees the TEXT NODE, which is
 * true, and concluded it was therefore impossible, which is false: the node's
 * `position` still spans the original source and the VFile still holds it, so
 * a transformer that takes `(tree, file)` can look. Verifying the narrow claim
 * and then generalising it was the mistake, not the checking.
 */

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: Record<string, unknown>;
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

/**
 * Two equals signs, then anything but a newline, then two more.
 *
 * Non-greedy so `==a== and ==b==` is two highlights rather than one that
 * swallows the middle. Single-line so an unclosed `==` cannot run to the end of
 * the document and highlight the rest of someone's note.
 *
 * Neither end may touch a third equals sign. Without that, prose comparing
 * things with `===` highlighted the middle of it: `a === b === c` marked
 * "= b ", which is not emphasis, it is someone writing about equality.
 */
const HIGHLIGHT = /(?<!=)==(?![\s=])((?:[^\n=]|=(?!=))+?)==(?!=)/g;

/**
 * Which highlights in this text node were written with a backslash before them.
 *
 * The node's value has the escape stripped, so `\==x==` and `==x==` look
 * identical there. The source does not: the node's position spans it. Escaping
 * removes only the backslash, never the `==`, so the Nth highlight-shaped run
 * in the value is the Nth in the source, and the source says which of them a
 * person meant literally.
 */
function escapedRuns(source: string): boolean[] {
  const escaped: boolean[] = [];
  const shape = /==(?:[^\n=]|=(?!=))+?==/g;
  for (const match of source.matchAll(shape)) {
    const at = match.index ?? 0;
    escaped.push(at > 0 && source[at - 1] === "\\");
  }
  return escaped;
}

function splitHighlights(text: string, escaped: boolean[] = []): MarkdownNode[] {
  const out: MarkdownNode[] = [];
  let last = 0;
  let index = -1;
  for (const match of text.matchAll(HIGHLIGHT)) {
    const start = match.index ?? 0;
    index += 1;
    if (escaped[index]) {
      // Written literally. Keep the characters and drop the highlight.
      out.push({ type: "text", value: text.slice(last, start + match[0].length) });
      last = start + match[0].length;
      continue;
    }
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

type VFileLike = { value?: unknown };

export function remarkHighlight() {
  // (tree, file), not (tree) alone: the file is where the backslash survives.
  return function transform(tree: MarkdownNode, file?: VFileLike) {
    const source = typeof file?.value === "string" ? file.value : "";
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
        const span = child.position;
        const slice =
          source && span?.start?.offset !== undefined && span?.end?.offset !== undefined
            ? source.slice(span.start.offset, span.end.offset)
            : "";
        children.push(
          ...splitHighlights(child.value, slice ? escapedRuns(slice) : []),
        );
      }
      node.children = children;
    };
    visit(tree);
  };
}
