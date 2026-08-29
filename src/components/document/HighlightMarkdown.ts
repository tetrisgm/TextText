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
 * The markers have to flank, the way emphasis does. An opening `==` follows
 * the start, whitespace, or opening punctuation; a closing one is followed by
 * the end, whitespace, or closing punctuation. Curly quotes and dashes count:
 * with an ASCII-only set, a phrase a person had wrapped in real quotation
 * marks or set off with an em dash did not highlight, which is exactly where
 * someone emphasises something. Without that, prose about code
 * became emphasis: `E==mc== squared` marked "mc", and `arr[i]==arr[j]==arr[k]`
 * marked "arr[j]". Neither is someone asking for a highlight; both are someone
 * writing about equality.
 *
 * And neither end may touch a third equals sign, or `a === b === c` marks
 * "= b " in the middle of a sentence about strict equality.
 */
const OPENS = '\\s([{"\'\u2018\u201c\u00ab\u2014\u2013\u2026';
const CLOSES = '\\s)\\]}.,;:!?"\'\u2019\u201d\u00bb\u2014\u2013\u2026';
const HIGHLIGHT = new RegExp(
  `(?<![^${OPENS}])(?<!=)==(?![\\s=])((?:[^\\n=]|=(?!=))+?)==(?!=)(?![^${CLOSES}])`,
  "g",
);

/**
 * Which highlights in this text node were written with a backslash before them.
 *
 * The node's value has the escape stripped, so `\==x==` and `==x==` look
 * identical there. The source does not: the node's position spans it.
 *
 * So rebuild the text the way Markdown will have it - dropping a backslash
 * before punctuation - and remember the positions where one was dropped.
 * Running the same pattern over the rebuilt string gives matches at the same
 * offsets as the node's value, and a match that starts where a backslash was
 * removed is one a person wrote literally.
 *
 * "The same offsets" holds for escapes and not for everything: a character
 * reference like `&#61;` is also resolved before the node value exists, and
 * this does not resolve those, so a document mixing entities and escapes can
 * put a flag on the wrong highlight. Escapes are what people use to mean the
 * characters; entities are not, and decoding them here would mean carrying a
 * second copy of Markdown's rules. Stated rather than silently assumed.
 *
 * Matching the raw source instead does not work: the opening marker of
 * `\==x==` is preceded by the backslash, which fails the flanking rule, so
 * the source would report fewer runs than the value and every flag after it
 * would land on the wrong highlight.
 */
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

function escapedRuns(source: string): boolean[] {
  let text = "";
  const escapedAt = new Set<number>();
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (character === "\\" && next && ASCII_PUNCTUATION.test(next)) {
      escapedAt.add(text.length);
      text += next;
      index += 1;
      continue;
    }
    text += character;
  }
  return [...text.matchAll(HIGHLIGHT)].map((match) =>
    escapedAt.has(match.index ?? 0),
  );
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
