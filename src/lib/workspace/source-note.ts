/** Quote literal source text without interpreting its Markdown as document structure. */
export function sourceNoteMarkdown(text: string, title: string, url: string): string {
  const literal = (value: string) => value.replace(/([\\`*_{}\[\]<>#+.!|~-])/g, "\\$1");
  const quote = text ? text.split("\n").map((line) => `> ${literal(line)}`).join("\n") : "";
  const source = `[${literal(title || "Source")}](${encodeURI(url).replace(/[()]/g, (char) => char === "(" ? "%28" : "%29")})`;
  return [quote, `Source: ${source}`].filter(Boolean).join("\n\n");
}
