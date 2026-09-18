import type { Post, ItemKind } from "@/lib/content";
import {
  DOCUMENT_SCHEMA_VERSION,
  type DocumentAsset,
  type DocumentFieldRow,
  type DocumentSnapshot,
  validateDocumentSnapshot,
} from "@/lib/documents/model";

const LEGACY_TEMPLATE: Record<ItemKind, string> = {
  article: "texttext.article",
  media_post: "texttext.gallery",
  video_post: "texttext.talk",
  note: "texttext.note",
  bookmark: "texttext.bookmark",
};

export function legacyTemplateId(type: ItemKind): string {
  return LEGACY_TEMPLATE[type];
}

function galleryAssets(post: Post): DocumentAsset[] {
  return (post.gallery ?? []).map((item, index) => ({
    id: `gallery-${index + 1}`,
    kind: /\.(?:mp4|webm|mov|m4v|ogv|ogg)(?:[?#].*)?$/i.test(item.src)
      ? "video"
      : "image",
    src: item.src,
    caption: item.caption,
    poster: item.poster,
  }));
}

/**
 * Every link a person wrote, as a field the snapshot can hold.
 *
 * `sourceUrl` and `sourceLabel` keep one link between them, which is what a
 * bookmark needs and what everything that reads a source still expects. An
 * item with several, a media post citing two essays for instance, had the
 * rest dropped on the first save that went through the document: the column
 * kept them, the snapshot could not, and the snapshot is what a save writes
 * from. A `rows` field is an array of records of scalars, which the schema
 * has always allowed, so the list fits with no migration and no new shape.
 */
function linkRows(links: Post["links"]): DocumentFieldRow[] | null {
  const rows = (links ?? [])
    .filter((link) => typeof link?.href === "string" && link.href.trim().length > 0)
    .map((link) => ({ href: link.href, label: link.label || link.href }));
  return rows.length > 0 ? rows : null;
}

/** The link list a document carries, or the single source it was built from. */
function projectedLinks(
  rows: unknown,
  sourceUrl: unknown,
  sourceLabel: unknown,
): Array<{ label: string; href: string }> | null {
  if (Array.isArray(rows)) {
    const links: Array<{ label: string; href: string }> = [];
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const { href, label } = row as DocumentFieldRow;
      if (typeof href !== "string" || href.trim().length === 0) continue;
      links.push({ href, label: typeof label === "string" && label.trim() ? label : href });
    }
    if (links.length > 0) return links;
  }
  if (typeof sourceUrl !== "string") return null;
  return [
    {
      label: typeof sourceLabel === "string" && sourceLabel.trim() ? sourceLabel : sourceUrl,
      href: sourceUrl,
    },
  ];
}

export function documentFromLegacyPost(post: Post): DocumentSnapshot {
  const sourceUrl = post.capture?.url ?? post.links?.[0]?.href;
  return validateDocumentSnapshot({
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    content: {
      title: post.title,
      subtitle: post.excerpt || undefined,
      body: post.body,
      fields: {
        ...(post.cover ? { cover: post.cover } : {}),
        ...(post.coverCaption ? { coverCaption: post.coverCaption } : {}),
        ...(post.coverHeight ? { coverHeight: post.coverHeight } : {}),
        ...(post.videoUrl ? { videoUrl: post.videoUrl } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(post.links?.[0]?.label
          ? { sourceLabel: post.links[0].label }
          : {}),
        ...(linkRows(post.links) ? { links: linkRows(post.links)! } : {}),
        ...(post.venue ? { venue: post.venue } : {}),
        ...(post.duration ? { duration: post.duration } : {}),
      },
      tags: post.tags ?? [],
      assets: galleryAssets(post),
    },
    presentation: {
      template: { id: legacyTemplateId(post.type), version: 1 },
      theme: {
        ...(post.accent ? { accent: post.accent } : {}),
      },
    },
  });
}

/**
 * Materialize the compatibility columns consumed by old sync clients and list
 * indexes. The canonical document remains the source of truth.
 */
export function legacyProjectionFromDocument(document: DocumentSnapshot) {
  const cover = document.content.fields.cover;
  const coverCaption = document.content.fields.coverCaption;
  const coverHeight = document.content.fields.coverHeight;
  const videoUrl = document.content.fields.videoUrl;
  const sourceUrl = document.content.fields.sourceUrl;
  const sourceLabel = document.content.fields.sourceLabel;
  const venue = document.content.fields.venue;
  const duration = document.content.fields.duration;
  return {
    title: document.content.title,
    excerpt: document.content.subtitle ?? "",
    body: document.content.body,
    tags: document.content.tags,
    accent: document.presentation.theme.accent ?? null,
    cover: typeof cover === "string" ? cover : null,
    coverCaption: typeof coverCaption === "string" ? coverCaption : null,
    coverHeight:
      typeof coverHeight === "number" && Number.isInteger(coverHeight)
        ? coverHeight
        : null,
    videoUrl: typeof videoUrl === "string" ? videoUrl : null,
    // The whole list when the document carries one, and the single source
    // otherwise, which is every document written before the field existed.
    links: projectedLinks(document.content.fields.links, sourceUrl, sourceLabel),
    venue: typeof venue === "string" ? venue : null,
    duration: typeof duration === "string" ? duration : null,
    gallery: document.content.assets.map((asset) => ({
      src: asset.src,
      caption: asset.caption,
      poster: asset.poster,
    })),
  };
}
