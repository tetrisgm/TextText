import type { Post, PostType } from "@/lib/content";
import {
  DOCUMENT_SCHEMA_VERSION,
  type DocumentAsset,
  type DocumentSnapshot,
  validateDocumentSnapshot,
} from "@/lib/documents/model";

const LEGACY_TEMPLATE: Record<PostType, string> = {
  article: "texttext.article",
  project: "texttext.gallery",
  talk: "texttext.talk",
  note: "texttext.note",
  bookmark: "texttext.bookmark",
};

export function legacyTemplateId(type: PostType): string {
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
  }));
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
    links:
      typeof sourceUrl === "string"
        ? [
            {
              label:
                typeof sourceLabel === "string" && sourceLabel.trim()
                  ? sourceLabel
                  : sourceUrl,
              href: sourceUrl,
            },
          ]
        : null,
    venue: typeof venue === "string" ? venue : null,
    duration: typeof duration === "string" ? duration : null,
    gallery: document.content.assets.map((asset) => ({
      src: asset.src,
      caption: asset.caption,
    })),
  };
}
