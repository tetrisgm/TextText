const MAX_ITEM_TITLE_LENGTH = 120;

type ParsedItemInput = {
  body: string;
  sourceUrl: string | null;
  title: string;
};

function cappedTitle(value: string): string {
  const clean = value
    .replace(/^#{1,6}\s+/, "")
    .replace(/^(?:user|human|prompt)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= MAX_ITEM_TITLE_LENGTH) return clean;
  return `${clean.slice(0, MAX_ITEM_TITLE_LENGTH - 3).trimEnd()}...`;
}

function normalizedHttpUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw || /\s/.test(raw)) return null;
  if (!/^https?:\/\//i.test(raw) && !raw.includes(".")) return null;
  for (const candidate of [raw, `https://${raw}`]) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.toString();
      }
    } catch {
      // Try the candidate with an explicit protocol.
    }
  }
  return null;
}

function transcriptTitle(lines: string[]): string | null {
  const roleLine = /^(?:user|human|prompt)\s*:\s*(.*)$/i;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].trim().match(roleLine);
    if (!match) continue;
    const inline = match[1]?.trim();
    if (inline) return cappedTitle(inline);
    const next = lines.slice(index + 1).find((line) => line.trim());
    if (next) return cappedTitle(next);
  }
  return null;
}

export function parseItemInput(value: string): ParsedItemInput {
  const cleanValue = value.trim();
  const sourceUrl = normalizedHttpUrl(cleanValue);
  if (sourceUrl) return { body: "", sourceUrl, title: "" };

  const lines = cleanValue.split(/\r?\n/);
  const contentLines = lines.filter((line) => line.trim());
  if (contentLines.length === 0) {
    return { body: "", sourceUrl: null, title: "" };
  }

  const looksLikeTranscript = lines.some((line) =>
    /^(?:user|human|prompt|assistant|claude|chatgpt|codex)\s*:/i.test(
      line.trim(),
    ),
  );
  const title =
    (looksLikeTranscript ? transcriptTitle(lines) : null) ??
    cappedTitle(contentLines[0]);

  return {
    body: lines.length > 1 ? cleanValue : "",
    sourceUrl: null,
    title: title || (looksLikeTranscript ? "Imported conversation" : "Untitled"),
  };
}
