const cardId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const prefix = "#texttext-card=";

export function noteCardHref(id: string): string {
  if (!cardId.test(id)) throw new Error("Invalid card identity.");
  return `${prefix}${id}`;
}

export function noteCardIdFromHref(href: string): string | null {
  if (!href.startsWith(prefix)) return null;
  const id = href.slice(prefix.length);
  return cardId.test(id) ? id : null;
}

export function noteCardBacklinkExcerpt(markdown: string, id: string): string | null {
  const href = noteCardHref(id);
  const lines = markdown.split("\n");
  for (const line of lines) {
    if (!line.includes(href)) continue;
    if (!/\[[^\]]+\]\(<#texttext-card=[A-Za-z0-9_-]+>\)/.test(line)) continue;
    const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`\\[[^\\]]+\\]\\(<${escaped}>\\)`).test(line)) continue;
    return line.replace(/\[([^\]]+)\]\(<#texttext-card=[A-Za-z0-9_-]+>\)/g, "$1").trim().slice(0, 240);
  }
  return null;
}
