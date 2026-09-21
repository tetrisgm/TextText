import { isSafePostSlug } from "@/lib/post-slug";

/** Quote literal text; internal references also protect imported sources from cleanup. */
export function sourceNoteMarkdown(text: string, title: string, url: string, sourceSlug?: string): string {
  const literal = (value: string) => value.replace(/([\\`*_{}\[\]<>#+.!|~-])/g, "\\$1");
  const quote = text ? text.split("\n").map((line) => `> ${literal(line)}`).join("\n") : "";
  const label = (title || "Source").replace(/[\r\n]+/g, " ").replace(/\[/g, "(").replace(/\]/g, ")");
  const source = sourceSlug && isSafePostSlug(sourceSlug)
    ? `[[${sourceSlug}|${label}]]`
    : `[${literal(title || "Source")}](${encodeURI(url).replace(/[()]/g, (char) => char === "(" ? "%28" : "%29")})`;
  return [quote, `Source: ${source}`].filter(Boolean).join("\n\n");
}
