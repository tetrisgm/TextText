/** One bounded emoji grapheme; stored as text, never markup or a remote image. */
export function noteIcon(value: unknown): string {
  if (typeof value !== "string" || value.length > 16) return "";
  const clean = value.trim();
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(clean)].length === 1 && (/\p{Extended_Pictographic}/u.test(clean) || /^\p{Regional_Indicator}{2}$/u.test(clean) || /^[0-9#*]\uFE0F?\u20E3$/u.test(clean)) ? clean : "";
}
