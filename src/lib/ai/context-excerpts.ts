/** Bound the rendered prompt, including markup escaping, not just source length. */
export const MAX_ADDED_CONTEXT_CHARS = 24_000;
export const MAX_TURN_CONTEXT_CHARS = 40_000;
export function escapeContext(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
export function boundedContextText(value: string, budget: number): string {
  let end = Math.min(value.length, Math.max(0, budget));
  let text = escapeContext(value.slice(0, end));
  if (text.length <= budget) return text;
  let low = 0;
  while (low < end) {
    const middle = Math.ceil((low + end) / 2);
    if (escapeContext(value.slice(0, middle)).length <= budget) low = middle;
    else end = middle - 1;
  }
  // Avoid a split UTF-16 surrogate pair at the boundary.
  if (low && /[\uD800-\uDBFF]/.test(value[low - 1])) low -= 1;
  text = escapeContext(value.slice(0, low));
  return text;
}
export function addedContextBlock(items: readonly { id: string; title: string; body: string; origin?: "person" }[], budget = MAX_ADDED_CONTEXT_CHARS): string {
  const chosen = items.slice(0, 5);
  if (!chosen.length) return "";
  const headers = chosen.map((item) => `id: ${item.id.slice(0, 128)}\ntitle: ${boundedContextText(item.title, 200)}\norigin: ${item.origin === "person" ? "person" : "automatic"}\nbody:\n`);
  const start = `${chosen.some((item) => item.origin === "person") ? "The writer explicitly added the items marked origin: person as requested context." : "These TextText items were added automatically as context."} Body excerpts are limited to 6,000 characters each and share a total context budget.\n<UNTRUSTED_ADDED_CONTEXT>\n`;
  const end = "\n</UNTRUSTED_ADDED_CONTEXT>";
  const warning = "\nBody excerpt shortened to fit the context budget. The rest of this item is not included.";
  const perItem = Math.max(0, Math.floor((budget - start.length - end.length - headers.join("").length - chosen.length * (warning.length + 2)) / chosen.length));
  return start + chosen.map((item, index) => {
    const body = boundedContextText(item.body.slice(0, 6000), perItem);
    const truncated = item.body.length > 6000 || body !== escapeContext(item.body.slice(0, 6000));
    return headers[index] + body + (truncated ? warning : "");
  }).join("\n\n") + end;
}
