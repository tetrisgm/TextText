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
import {
  templateDefinitionSchema,
  type TemplateDefinition,
} from "@/lib/presentation/schema";
import { z } from "zod";

export const SYNC_DOCUMENT_SCHEMA = "texttext.sync-document.v1" as const;
export const SYNC_DOCUMENT_CONTENT_TYPE =
  "application/vnd.texttext.document+json";

const syncDocumentEnvelopeSchema = z
  .object({
    schema: z.literal(SYNC_DOCUMENT_SCHEMA),
    markdown: z.string().max(12_000_000),
    document: documentSnapshotSchema,
    /**
     * The look itself, not just the reference to it.
     *
     * `document.presentation.template` names an id and a version, which is
     * enough inside the workspace that stores it and nothing at all outside.
     * A textpack handed to someone else, or opened by another tool, could
     * carry a recipe's cook time and still not know how a recipe is meant to
     * read. Inlining the definition is what makes the file self describing,
     * which is the promise in SPEC.md pillar 1.
     *
     * Optional, so an envelope written before this existed still parses, and
     * so a document pinned to a look that has since been deleted still syncs.
     */
    // `.catch` so a look the server cannot parse becomes absent instead of
    // rejecting the envelope. Without it, the strict template was validated as
    // part of the whole document: an unreadable look threw here, the PUT route
    // returned 400, and the person lost the words they had just written. The
    // comment there promised best effort and the code did the opposite.
    //
    // This is the ingress boundary for files that live outside the database
    // and never expire, so it has to degrade rather than refuse.
    template: templateDefinitionSchema.optional().catch(undefined),
  })
  .strict();

type SyncDocumentEnvelope = z.infer<typeof syncDocumentEnvelopeSchema>;

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

/**
 * A comparable string for a JSON value, independent of key order. Two sides of
 * the same document (one out of jsonb, one built in memory) serialize their
 * keys in different orders, so plain JSON.stringify equality reports a change
 * where there is none.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortedJson(value));
}

export function serializeSyncDocumentEnvelope(
  envelope: SyncDocumentEnvelope,
): string {
  return `${JSON.stringify(sortedJson(envelope), null, 2)}\n`;
}

export function renderSyncDocumentEnvelope({
  markdown,
  post,
  template,
}: {
  markdown: string;
  post: Post;
  /** Resolved by the caller, which is the only side that can reach the store. */
  template?: TemplateDefinition | null;
}): SyncDocumentEnvelope {
  return {
    schema: SYNC_DOCUMENT_SCHEMA,
    markdown,
    document: requireDocumentSnapshot(
      post.document,
      `Persisted item ${post.id ?? post.slug}`,
    ),
    ...(template ? { template } : {}),
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

/**
 * The gallery the file carries, merged onto the assets the document already
 * holds rather than replacing them.
 *
 * Markdown can say a picture's address and its caption. It cannot say its alt
 * text, its dimensions or its content type, and text.md renders a `gallery:`
 * key for every item that has assets at all, so rebuilding the list from the
 * file stripped those off every save that went through the file. Markdown
 * winning over a field it cannot express is not markdown winning.
 */
function assetsFromGallery(gallery: GalleryItem[], existing: readonly DocumentAsset[] = []): DocumentAsset[] {
  const bySrc = new Map(existing.map((asset) => [asset.src, asset]));
  return gallery.map((item, index) => {
    // Matched by address first, then by position, which is how an unchanged
    // list keeps everything through a caption edit.
    const kept = bySrc.get(item.src) ?? (existing[index]?.src === item.src ? existing[index] : undefined);
    return {
      ...kept,
      id: kept?.id ?? `gallery-${index + 1}`,
      kind:
        kept?.kind ??
        (/\.(?:mp4|webm|mov|m4v|ogv|ogg)(?:[?#].*)?$/i.test(item.src) ? "video" : "image"),
      src: item.src,
      caption: item.caption,
      poster: item.poster ?? kept?.poster,
    };
  });
}

function setSourceFields(
  fields: Record<string, DocumentFieldValue>,
  links: LinkRef[] | null | undefined,
): void {
  setDocumentField(fields, "sourceUrl", links?.[0]?.href);
  setDocumentField(fields, "sourceLabel", links?.[0]?.label);
  // The whole list, not only the first. A file carrying three links used to
  // arrive with one and be re-rendered with one, so the person's own copy
  // stopped holding the rest too.
  const rows = (links ?? [])
    .filter((link) => typeof link?.href === "string" && link.href.trim().length > 0)
    .map((link) => ({ href: link.href, label: link.label || link.href }));
  if (rows.length > 0) fields.links = rows;
  else delete fields.links;
}

/**
 * What a file says that a save would quietly not keep.
 *
 * A file carrying a key the document has no place for used to be accepted
 * with a 200, and the next render of that file left the line out, so the
 * person's own copy stopped holding it either: the write reported success and
 * the words were gone from both sides. Refusing names what to do about it,
 * which is the one thing silence cannot. The MCP front door has always
 * refused unknown keys; this is the other front door agreeing with it.
 *
 * Links used to be refused here too, because the snapshot kept only the
 * first. It keeps them all now, so there is nothing left to refuse.
 */
export function refuseUnsupportedMarkdown(parsed: ParsedPostMarkdownFile): void {
  const unknown = parsed.unknownKeys ?? [];
  if (unknown.length > 0) {
    throw new Error(
      `text.md does not keep these keys, so saving would delete them: ${unknown.join(", ")}. Move what they say into the body.`,
    );
  }

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
        ? assetsFromGallery(parsed.fields.gallery ?? [], document.content.assets ?? [])
        : document.content.assets,
    },
    presentation: {
      ...document.presentation,
      theme,
    },
  });
}
