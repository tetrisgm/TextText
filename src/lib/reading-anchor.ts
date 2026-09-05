// Carries the reader's place into the editor.
//
// Read and edit share one scroll position, but the two layouts differ (the
// reader's title sits in the bar, the editor's in the sheet; rendered prose
// and source lines wrap differently), so the same scrollTop showed the editor
// a little off from where the reader was. The reader remembers the text of
// its topmost visible block; the surface finds it in the source and reveals
// that line.

let pending: string | null = null;

export function rememberReadingAnchor(text: string | null): void {
  pending = text && text.trim() ? text.trim().replace(/\s+/g, " ") : null;
}

/** True while an anchor waits for the editor; the scroll restore yields to it. */
export function hasReadingAnchor(): boolean {
  return pending !== null;
}

export function consumeReadingAnchor(): string | null {
  const value = pending;
  pending = null;
  return value;
}

/** Text of the first block whose bottom edge is below `viewTop`. */
export function topVisibleBlockText(
  root: ParentNode,
  viewTop: number,
  selector = ".tt-prose > *, .tt-field-body > *",
): string | null {
  for (const block of root.querySelectorAll(selector)) {
    const rect = (block as HTMLElement).getBoundingClientRect();
    if (rect.height === 0 || rect.bottom <= viewTop + 8) continue;
    const text = block.textContent?.trim().replace(/\s+/g, " ") ?? "";
    if (text.length >= 8) return text.slice(0, 80);
  }
  return null;
}

const MARKUP = /[*_`~\[\]()>#|]/g;

/**
 * Offset of the anchor text in Markdown `source`, or -1. Tries the raw
 * source first, then a copy with emphasis and link punctuation removed,
 * mapping the offset back through what was removed.
 */
export function offsetOfReadingAnchor(source: string, anchor: string): number {
  const flat = source.replace(/\s+/g, " ");
  const prefixes = [60, 40, 24, 12].map((n) => anchor.slice(0, n)).filter(Boolean);
  for (const prefix of prefixes) {
    const at = flat.indexOf(prefix);
    if (at >= 0) return mapFlatOffset(source, at);
  }
  // Emphasis and links: "**Web Summit**, 13" reads as "Web Summit, 13".
  const kept: number[] = [];
  let stripped = "";
  for (let index = 0; index < flat.length; index += 1) {
    const char = flat[index];
    if (MARKUP.test(char)) { MARKUP.lastIndex = 0; continue; }
    MARKUP.lastIndex = 0;
    kept.push(index);
    stripped += char;
  }
  for (const prefix of prefixes) {
    const at = stripped.indexOf(prefix.replace(MARKUP, ""));
    if (at >= 0 && kept[at] !== undefined) return mapFlatOffset(source, kept[at]);
  }
  return -1;
}

/** Map an offset in the whitespace-collapsed source back to the real source. */
function mapFlatOffset(source: string, flatOffset: number): number {
  let flat = 0;
  let inSpace = false;
  for (let index = 0; index < source.length; index += 1) {
    const isSpace = /\s/.test(source[index]);
    // The match begins on a real character; a collapsed run of whitespace
    // before it counts once and must not be where the offset lands.
    if (flat >= flatOffset && !isSpace) return index;
    if (isSpace) {
      if (!inSpace) flat += 1;
      inSpace = true;
    } else {
      flat += 1;
      inSpace = false;
    }
  }
  return source.length;
}
