// Replace across the open document. Literal, never a regular expression: the
// find bar is a plain text field, and a person typing "cost (est.)" means
// those characters, not a group.

export type ReplaceOptions = { caseSensitive?: boolean };

export type ReplaceResult = { text: string; count: number };

/** Every occurrence of `find`, replaced. Returns the count so the UI can say
 * what happened, and leaves the text untouched when `find` is empty. */
export function replaceAllInText(
  source: string,
  find: string,
  replacement: string,
  options: ReplaceOptions = {},
): ReplaceResult {
  if (!find) return { text: source, count: 0 };
  const caseSensitive = options.caseSensitive ?? false;
  const haystack = caseSensitive ? source : source.toLowerCase();
  const needle = caseSensitive ? find : find.toLowerCase();
  let out = "";
  let cursor = 0;
  let count = 0;
  for (;;) {
    const at = haystack.indexOf(needle, cursor);
    if (at === -1) break;
    out += source.slice(cursor, at) + replacement;
    cursor = at + find.length;
    count += 1;
  }
  if (!count) return { text: source, count: 0 };
  return { text: out + source.slice(cursor), count };
}

/** Raised with `{ find, replace, caseSensitive }`; the open editor answers. */
export const DOCUMENT_REPLACE_EVENT = "texttext:document-replace-all";

export type ReplaceRequest = {
  find: string;
  replace: string;
  caseSensitive?: boolean;
};

export function requestDocumentReplaceAll(request: ReplaceRequest): void {
  window.dispatchEvent(
    new CustomEvent(DOCUMENT_REPLACE_EVENT, { detail: request }),
  );
}

/** Raised to put the caret in the replace field. */
export const FOCUS_REPLACE_EVENT = "texttext:focus-replace";

export function requestFocusReplace(): void {
  window.dispatchEvent(new Event(FOCUS_REPLACE_EVENT));
}
