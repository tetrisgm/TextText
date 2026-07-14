export function isRemoteImageUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function remoteMarkdownImageUrls(
  markdown: string | undefined,
): string[] {
  if (!markdown) return [];

  const pattern =
    /!\[[^\]]*]\(\s*<?(https?:\/\/[^\s<>)]+)>?(?:\s+["'][^)]*["'])?\s*\)/gi;
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of markdown.matchAll(pattern)) {
    const url = match[1]?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

export function localizeRemoteMarkdownImages(
  markdown: string,
  replacements: Map<string, string>,
): string {
  if (replacements.size === 0) return markdown;
  return markdown.replace(
    /(!\[[^\]]*]\(\s*<?)(https?:\/\/[^\s<>)]+)(>?)(\s+["'][^)]*["'])?(\s*\))/gi,
    (match, prefix: string, src: string, closing: string, title = "", suffix: string) => {
      const replacement = replacements.get(src);
      if (!replacement) return match;
      return `${prefix}${replacement}${closing}${title}${suffix}`;
    },
  );
}

export function stripRemoteMarkdownImages(
  markdown: string,
  opts: { preserveUrls?: Set<string> } = {},
): string {
  const preserveUrls = opts.preserveUrls ?? new Set<string>();
  return markdown
    .replace(
      /\[!\[[^\]]*]\(\s*<?https?:\/\/[^\s<>)]+>?(?:\s+["'][^)]*["'])?\s*\)]\(\s*<?https?:\/\/[^\s<>)]+>?(?:\s+["'][^)]*["'])?\s*\)/gi,
      (match) => {
        const image = match.match(
          /!\[[^\]]*]\(\s*<?(https?:\/\/[^\s<>)]+)>?(?:\s+["'][^)]*["'])?\s*\)/i,
        );
        const src = image?.[1];
        return src && preserveUrls.has(src) ? match : "";
      },
    )
    .replace(
      /!\[[^\]]*]\(\s*<?https?:\/\/[^\s<>)]+>?(?:\s+["'][^)]*["'])?\s*\)/gi,
      (match) => {
        const image = match.match(
          /!\[[^\]]*]\(\s*<?(https?:\/\/[^\s<>)]+)>?(?:\s+["'][^)]*["'])?\s*\)/i,
        );
        const src = image?.[1];
        return src && preserveUrls.has(src) ? match : "";
      },
    )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
