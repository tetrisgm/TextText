import type { GalleryItem, LinkRef } from "@/lib/content";
import type { Post } from "@/lib/content";
import {
  documentSnapshotSchema,
  requireDocumentSnapshot,
  type DocumentAsset,
  type DocumentFieldValue,
  type DocumentSnapshot,
  validateDocumentSnapshot,
} from "@/lib/documents/model";
import type { ParsedPostMarkdownFile } from "@/lib/markdown-files";
import { z } from "zod";

export const SYNC_DOCUMENT_SCHEMA = "texttext.sync-document.v1" as const;
export const SYNC_DOCUMENT_CONTENT_TYPE =
  "application/vnd.texttext.document+json";

const syncDocumentEnvelopeSchema = z
  .object({
    schema: z.literal(SYNC_DOCUMENT_SCHEMA),
    markdown: z.string().max(12_000_000),
    document: documentSnapshotSchema,
  })
  .strict();

export type SyncDocumentEnvelope = z.infer<typeof syncDocumentEnvelopeSchema>;

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function sortedJson(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(sortedJson);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortedJson(entry)]),
    );
  }
  throw new Error("The sync document contains a non-JSON value");
}

export function serializeSyncDocumentEnvelope(
  envelope: SyncDocumentEnvelope,
): string {
  return `${JSON.stringify(sortedJson(envelope), null, 2)}\n`;
}

export function renderSyncDocumentEnvelope({
  markdown,
  post,
}: {
  markdown: string;
  post: Post;
}): SyncDocumentEnvelope {
  return {
    schema: SYNC_DOCUMENT_SCHEMA,
    markdown,
    document: requireDocumentSnapshot(
      post.document,
      `Persisted item ${post.id ?? post.slug}`,
    ),
  };
}

export function parseSyncDocumentEnvelope(raw: string): SyncDocumentEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("The structured document is not valid JSON");
  }
  return syncDocumentEnvelopeSchema.parse(value);
}

export function requestUsesSyncDocument(request: Request): boolean {
  return request.headers
    .get("content-type")
    ?.toLowerCase()
    .startsWith(SYNC_DOCUMENT_CONTENT_TYPE) ?? false;
}

export function requestAcceptsSyncDocument(request: Request): boolean {
  return (request.headers.get("accept") ?? "")
    .toLowerCase()
    .split(",")
    .some((entry) => entry.trim().startsWith(SYNC_DOCUMENT_CONTENT_TYPE));
}

function hasOwn<K extends keyof ParsedPostMarkdownFile["fields"]>(
  parsed: ParsedPostMarkdownFile,
  key: K,
): boolean {
  return Object.prototype.hasOwnProperty.call(parsed.fields, key);
}

function setDocumentField(
  fields: Record<string, DocumentFieldValue>,
  key: string,
  value: unknown,
): void {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
  ) {
    fields[key] = value;
  } else {
    delete fields[key];
  }
}

function assetsFromGallery(gallery: GalleryItem[]): DocumentAsset[] {
  return gallery.map((item, index) => ({
    id: `gallery-${index + 1}`,
    kind: /\.(?:mp4|webm|mov|m4v|ogv|ogg)(?:[?#].*)?$/i.test(item.src)
      ? "video"
      : "image",
    src: item.src,
    caption: item.caption,
  }));
}

function setSourceFields(
  fields: Record<string, DocumentFieldValue>,
  links: LinkRef[] | null | undefined,
): void {
  setDocumentField(fields, "sourceUrl", links?.[0]?.href);
  setDocumentField(fields, "sourceLabel", links?.[0]?.label);
}

/**
 * `document.json` owns structured content and presentation. `text.md` remains
 * deliberately useful in ordinary editors, so explicitly authored Markdown
 * fields win over their structured equivalents and the Markdown body always
 * wins. Unknown frontmatter stays outside the document schema rather than
 * becoming an unvalidated rendering input.
 */
export function mergeMarkdownIntoDocument(
  input: DocumentSnapshot,
  parsed: ParsedPostMarkdownFile,
): DocumentSnapshot {
  const document = validateDocumentSnapshot(input);
  const fields = { ...document.content.fields };
  const theme = { ...document.presentation.theme };

  if (hasOwn(parsed, "cover")) {
    setDocumentField(fields, "cover", parsed.fields.cover);
  }
  if (hasOwn(parsed, "coverCaption")) {
    setDocumentField(fields, "coverCaption", parsed.fields.coverCaption);
  }
  if (hasOwn(parsed, "coverHeight")) {
    setDocumentField(fields, "coverHeight", parsed.fields.coverHeight);
  }
  if (hasOwn(parsed, "videoUrl")) {
    setDocumentField(fields, "videoUrl", parsed.fields.videoUrl);
  }
  if (hasOwn(parsed, "venue")) {
    setDocumentField(fields, "venue", parsed.fields.venue);
  }
  if (hasOwn(parsed, "duration")) {
    setDocumentField(fields, "duration", parsed.fields.duration);
  }
  if (hasOwn(parsed, "links")) {
    setSourceFields(fields, parsed.fields.links);
  }
  if (hasOwn(parsed, "accent")) {
    const accent = parsed.fields.accent;
    if (accent && /^#[0-9a-fA-F]{6}$/.test(accent)) theme.accent = accent;
    else delete theme.accent;
  }

  return validateDocumentSnapshot({
    ...document,
    content: {
      ...document.content,
      title: parsed.fields.title ?? document.content.title,
      subtitle: hasOwn(parsed, "excerpt")
        ? parsed.fields.excerpt || undefined
        : document.content.subtitle,
      body: parsed.body,
      fields,
      tags: hasOwn(parsed, "tags")
        ? parsed.fields.tags ?? []
        : document.content.tags,
      assets: hasOwn(parsed, "gallery")
        ? assetsFromGallery(parsed.fields.gallery ?? [])
        : document.content.assets,
    },
    presentation: {
      ...document.presentation,
      theme,
    },
  });
}
