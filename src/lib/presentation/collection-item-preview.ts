import { postBodyPreview, type Post } from "@/lib/content";
import { documentFromLegacyPost } from "@/lib/documents/legacy";
import { resolveCoverSource } from "@/lib/cover";
import type { DocumentSnapshot } from "@/lib/documents/model";
import type { TemplateDefinition } from "./schema";

/** A bounded, non-mutating projection. A folder never parses an entire article. */
export function collectionItemPreview(post: Post, template: TemplateDefinition) {
  const raw = post.document;
  const body = (raw?.content.body ?? postBodyPreview(post)).slice(0, 1200);
  const document: DocumentSnapshot = raw ? { ...raw, content: { ...raw.content, body } }
    : documentFromLegacyPost({ ...post, body });
  if (!raw) {
    document.presentation.template = post.template ?? { id: template.id, version: template.version };
    document.content.fields = { ...document.content.fields, ...post.collectionFields };
  }
  const excerpt = (post.excerpt || post.capture?.description || body).slice(0, 900)
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[\s#*>`-]+/gm, "").replace(/[*_~]/g, "").replace(/\s+/g, " ").trim();
  const cover = resolveCoverSource(post).src;
  if (cover && !document.content.fields.cover) document.content = { ...document.content,
    fields: { ...document.content.fields, cover } };
  let host = "";
  const url = document.content.fields.sourceUrl ?? post.capture?.url ?? post.links?.[0]?.href;
  if (typeof url === "string") { try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* No source host. */ } }
  const prose: Record<string, string> = { "content.body": excerpt };
  for (const field of template.fields) {
    if (field.type === "richtext") {
      const value = document.content.fields[field.id];
      if (typeof value === "string") prose[`content.fields.${field.id}`] = value.slice(0, 900);
    }
  }
  // Built-in articles already show a subtitle when present. Supply a body
  // excerpt only when it would add content; notes/custom types own their prose.
  const supplement = template.id.startsWith("texttext.") && template.id !== "texttext.note"
    && !document.content.subtitle?.trim() ? excerpt : "";
  return { document, slots: { prose }, excerpt: supplement, host };
}
