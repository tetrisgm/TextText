import { isSafePostSlug } from "@/lib/post-slug";

export type WikiLinkReference = {
  target: string;
  label: string;
};

export type WikiLinkTextPart =
  | { kind: "text"; value: string }
  | ({ kind: "wikilink" } & WikiLinkReference);

function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

export function parseWikiLinkInner(value: string): WikiLinkReference | null {
  const separator = value.indexOf("|");
  const target = (separator < 0 ? value : value.slice(0, separator)).trim();
  if (!isSafePostSlug(target)) return null;
  const rawLabel = separator < 0 ? target : value.slice(separator + 1).trim();
  const label = rawLabel || target;
  if (!label || /[\r\n]/.test(label)) return null;
  return { target, label };
}

/** Split ordinary markdown text without interpreting headings or hashtags. */
export function splitWikiLinkText(value: string): WikiLinkTextPart[] {
  const parts: WikiLinkTextPart[] = [];
  let textStart = 0;
  let cursor = 0;

  while (cursor < value.length - 1) {
    if (
      value[cursor] !== "[" ||
      value[cursor + 1] !== "[" ||
      isEscaped(value, cursor)
    ) {
      cursor += 1;
      continue;
    }

    const close = value.indexOf("]]", cursor + 2);
    if (close < 0) break;
    const reference = parseWikiLinkInner(value.slice(cursor + 2, close));
    if (!reference) {
      cursor += 2;
      continue;
    }

    if (cursor > textStart) {
      parts.push({ kind: "text", value: value.slice(textStart, cursor) });
    }
    parts.push({ kind: "wikilink", ...reference });
    cursor = close + 2;
    textStart = cursor;
  }

  if (textStart < value.length) {
    parts.push({ kind: "text", value: value.slice(textStart) });
  }
  return parts.length > 0 ? parts : [{ kind: "text", value }];
}

export function serializeWikiLink(reference: WikiLinkReference): string {
  const label = reference.label.trim() || reference.target;
  return label === reference.target
    ? `[[${reference.target}]]`
    : `[[${reference.target}|${label}]]`;
}
