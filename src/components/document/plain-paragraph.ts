/** A conservative subset of CommonMark that needs no tokenizer. Everything
 * ambiguous retains the full Markdown pipeline, including GFM autolinks. */
export function plainParagraph(value: string): string | null {
  if (/www\./i.test(value)) return null;
  if (!value || /[^\p{L}\p{M}\p{N} ,.\n]/u.test(value)) return null;
  let start = 0, end = value.length;
  while (start < end && value[start] === "\n") start++;
  while (end > start && value[end - 1] === "\n") end--;
  const text = value.slice(start, end);
  if (!text.trim() || /\n *\n|^ |\n |(?:^|\n)\d+\. /u.test(text)) return null;
  // Leave all whitespace normalization and hard breaks to the full parser.
  if (/ (?:\n|$)/.test(text)) return null;
  return text;
}
