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
