// The document's headings, for jumping around a long piece of writing the way
// an editor's symbol list does. Parsed from the markdown source, because the
// source is what the editing surface renders and what line numbers refer to.

export type OutlineEntry = {
  /** 0-based line in the body. */
  line: number;
  /** 1-6, from the number of leading hashes. */
  level: number;
  /** The heading text, hashes stripped. */
  text: string;
};

/** Raised with `{ line }` to move the editing surface to a line. */
export const DOCUMENT_JUMP_EVENT = "texttext:document-jump-to-line";

export function requestDocumentJump(line: number): void {
  window.dispatchEvent(
    new CustomEvent(DOCUMENT_JUMP_EVENT, { detail: { line } }),
  );
}

const HEADING = /^(\s{0,3})(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s{0,3}(```|~~~)/;

export function documentOutline(body: string): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  let fence: string | null = null;
  body.split("\n").forEach((line, index) => {
    const fenced = FENCE.exec(line);
    if (fenced) {
      // A hash inside a code block is code, not a heading.
      if (fence === null) fence = fenced[1];
      else if (line.trimStart().startsWith(fence)) fence = null;
      return;
    }
    if (fence !== null) return;
    const heading = HEADING.exec(line);
    if (!heading) return;
    const text = heading[3].trim();
    if (!text) return;
    out.push({ line: index, level: heading[2].length, text });
  });
  return out;
}

// The body of the document currently open in an editor. Registered by the
// editor itself because that is the only place guaranteed to have it: the
// pool's list projection carries no body, the lazy cache is not populated on
// every route, and an editor route may be handed its document directly. It is
// also the LIVE body, so the outline reflects headings typed a moment ago.
let activeBody: string | null = null;

export function setActiveDocumentBody(body: string | null): void {
  activeBody = body;
}

export function activeDocumentBody(): string | null {
  return activeBody;
}
