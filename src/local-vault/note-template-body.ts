export function noteTemplateBody(body: string): string {
  if (!body.trim() || body.length > 100_000) throw new Error("Choose text up to 100,000 characters.");
  if (/!\[|<(?:img|audio|video|source|object|iframe)\b|assets\/|data:|blob:/i.test(body)) throw new Error("Text templates support text and links. Remove embedded images and attachments first.");
  for (const link of body.matchAll(/\]\(<?([^\s)>]+)/g)) {
    if (!/^(https?:|texttext:|#)/i.test(link[1])) throw new Error("Text templates support web and card links, not local attachments.");
  }
  for (const reference of body.matchAll(/^ {0,3}\[[^\]\n]+\]:[ \t]*<?([^\s>]+)/gm)) {
    if (!/^(https?:|texttext:|#)/i.test(reference[1])) throw new Error("Text templates support web and card links, not local attachments.");
  }
  return body;
}
