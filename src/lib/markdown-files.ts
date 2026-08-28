import type {
  Blog,
  BlogHomeLayout,
  Folder,
  FolderMode,
  GalleryItem,
  ItemKind,
  LinkRef,
  Post,
  PostType,
} from "@/lib/content";
import { collectionPageLayout, isSafeLinkHref } from "@/lib/content";
import { getBuiltinTemplate } from "@/lib/presentation/templates";
import { markdownFileHash } from "@/lib/content-hash";
import { isNoCoverValue } from "@/lib/cover";
import { sanitizePostSlug } from "@/lib/post-slug";
import { normalizeTags } from "@/lib/tags";
import {
  markdownSubtitle,
  postBodyWithSubtitle,
} from "@/lib/markdown-subtitle";

const TEXTTEXT_FOLDER_SCHEMA = "texttext.folder.v1";
const TEXTTEXT_MARKDOWN_FILE_SCHEMA = "texttext.markdown-file.v1";
const DEFAULT_FOLDER_MODE = "blog";
const BLOG_FOLDER_VIEWS = ["timeline", "index", "grid", "single"] as const;
// The Blog folder's public vocabulary; Notes and Bookmarks folders each carry
// their single native kind.
const BLOG_ITEM_KINDS = ["article", "media_post", "video_post"] as const;
const NOTES_ITEM_KINDS = ["note"] as const;
const BOOKMARKS_ITEM_KINDS = ["bookmark"] as const;

type BlogItemKind = (typeof BLOG_ITEM_KINDS)[number];
/** Every kind the markdown surface can carry across folder modes. */
export type MarkdownItemKind = BlogItemKind | "note" | "bookmark";

export type MarkdownFolderItem = {
  file: string;
  kind: MarkdownItemKind;
  slug: string;
  title: string;
  status: Post["status"];
  /** database id; absent for demo/seed content */
  id?: string;
  date?: string;
  createdAt?: string;
  updatedAt?: string;
  /** authenticated content transport URL used by sync clients */
  url?: string;
  /** canonical human-facing page URL; never an authenticated API endpoint */
  canonicalUrl?: string;
  /** sha256 hex of the rendered markdown file, for cheap change detection */
  hash: string;
  /** UTF-8 byte length of the rendered markdown file. The File Provider needs it
   * at enumeration time to set each item's documentSize, or the system sizes the
   * dataless placeholder at zero and never grows it when the content is fetched. */
  size: number;
};

type MarkdownFolderManifest = {
  schema: typeof TEXTTEXT_FOLDER_SCHEMA;
  folder: {
    handle: string;
    name: string;
    mode: FolderMode;
    views: typeof BLOG_FOLDER_VIEWS;
    itemKinds: readonly MarkdownItemKind[];
    activeView: BlogHomeLayout;
    id?: string;
    path?: string;
  };
  items: MarkdownFolderItem[];
};

/**
 * The view a folder's manifest reports: the layout its look declares.
 *
 * This is a synchronous render, so a workspace's own look cannot be fetched
 * here; the built-ins cover every folder that has not been customized, and a
 * customized one reports cards. The manifest is a projection for file clients,
 * not the thing that decides how a page renders.
 */
function folderActiveView(folder: Folder | undefined): BlogHomeLayout {
  const reference = folder?.defaultTemplate;
  if (!reference) return "grid";
  return collectionPageLayout(
    getBuiltinTemplate(reference.id, reference.version)?.collection.layout,
  );
}

export type RenderFolderManifestOptions = {
  folder?: Folder;
  /** include workspace-only metadata such as personal stars in file hashes */
  includePersonalMetadata?: boolean;
  /** public URL of the post's markdown file (index.md) */
  fileUrlFor?: (post: Post) => string;
  /** canonical public URL of the post, baked into each file's frontmatter */
  postUrlFor?: (post: Post) => string;
  /** exact file representation whose bytes the manifest hashes and sizes */
  renderFileFor?: (post: Post) => string;
};

export function itemKindForPostType(type: PostType): MarkdownItemKind {
  if (type === "project") return "media_post";
  if (type === "talk") return "video_post";
  if (type === "note") return "note";
  if (type === "bookmark") return "bookmark";
  return "article";
}

export function postTypeForItemKind(kind: ItemKind): PostType {
  if (kind === "media_post") return "project";
  if (kind === "video_post") return "talk";
  if (kind === "note") return "note";
  if (kind === "bookmark") return "bookmark";
  return "article";
}

/** The kinds a folder's manifest advertises, by its mode; blog is the default. */
function itemKindsForFolderMode(
  mode: FolderMode | undefined,
): readonly MarkdownItemKind[] {
  if (mode === "notes") return NOTES_ITEM_KINDS;
  if (mode === "bookmarks") return BOOKMARKS_ITEM_KINDS;
  return BLOG_ITEM_KINDS;
}

export function markdownFilePathForPost(post: Pick<Post, "slug">): string {
  return `posts/${post.slug}.md`;
}

/** The folder mode an item's kind belongs to (a note's file says mode notes). */
export function folderModeForPostType(type: PostType): FolderMode {
  if (type === "note") return "notes";
  if (type === "bookmark") return "bookmarks";
  return "blog";
}

export function renderFolderManifest(
  blog: Blog,
  posts: Post[],
  options?: RenderFolderManifestOptions,
): MarkdownFolderManifest {
  const folder = options?.folder;
  return {
    schema: TEXTTEXT_FOLDER_SCHEMA,
    folder: {
      handle: blog.handle,
      name: blog.name,
      mode: folder?.mode ?? DEFAULT_FOLDER_MODE,
      views: BLOG_FOLDER_VIEWS,
      itemKinds: itemKindsForFolderMode(folder?.mode),
      activeView: folderActiveView(folder),
      ...(folder ? { id: folder.id, path: folder.path } : {}),
    },
    items: posts.map((post) => {
      const rendered =
        options?.renderFileFor?.(post) ??
        renderPostMarkdownFile({
          blog,
          canonicalUrl: options?.postUrlFor?.(post),
          includePersonalMetadata: options?.includePersonalMetadata,
          post,
        });
      return {
        file: markdownFilePathForPost(post),
        kind: itemKindForPostType(post.type),
        slug: post.slug,
        title: post.title,
        status: post.status,
        ...(post.id ? { id: post.id } : {}),
        ...(post.date ? { date: post.date } : {}),
        ...(post.createdAt ? { createdAt: post.createdAt } : {}),
        ...(post.updatedAt ? { updatedAt: post.updatedAt } : {}),
        ...(options?.fileUrlFor ? { url: options.fileUrlFor(post) } : {}),
        ...(options?.postUrlFor
          ? { canonicalUrl: options.postUrlFor(post) }
          : {}),
        hash: markdownFileHash(rendered),
        size: new TextEncoder().encode(rendered).length,
      };
    }),
  };
}

export function renderPostMarkdownFile({
  blog,
  canonicalUrl,
  includePersonalMetadata = true,
  post,
  syncRevision,
}: {
  blog: Blog;
  canonicalUrl?: string;
  /** false for public Markdown; authenticated sync keeps the default */
  includePersonalMetadata?: boolean;
  post: Post;
  /** reserved sync validator; omitted from every public Markdown surface */
  syncRevision?: number;
}): string {
  const frontmatter: Record<string, unknown> = {
    schema: TEXTTEXT_MARKDOWN_FILE_SCHEMA,
    ...(typeof syncRevision === "number" ? { syncRevision } : {}),
    // The workspace's display name. (Was `folder: blog.handle` - the internal
    // three-word handle, which read as a wrong/meaningless "folder" in the file.
    // The post's actual folder is evident from the file's location in the tree,
    // and `mode` below distinguishes Blog/Notes/Bookmarks.)
    workspace: blog.name,
    mode: folderModeForPostType(post.type),
    kind: itemKindForPostType(post.type),
    type: post.type,
    slug: post.slug,
    title: post.title,
    status: post.status,
  };

  // A draft's date is derived display state (createdAt, or the date of an
  // earlier publish), never authored: rendering it into the file would make a
  // later publish-by-file backdate the post instead of stamping now.
  if (post.status === "published") addOptional(frontmatter, "date", post.date);
  addOptional(frontmatter, "canonical", canonicalUrl);
  // An empty accent is a meaningful opt-out of the blog accent (postAccent in
  // content.ts), so it renders as accent: "" rather than disappearing.
  if (post.accent !== undefined) frontmatter.accent = post.accent;
  if (post.pinned) frontmatter.pinned = true;
  if (includePersonalMetadata && post.starred) frontmatter.starred = true;
  addOptional(frontmatter, "cover", cleanCover(post.cover));
  addOptional(frontmatter, "coverCaption", post.coverCaption);
  addOptionalNumber(frontmatter, "coverHeight", post.coverHeight);
  addGallery(frontmatter, post.gallery);
  addLinks(frontmatter, post.links);
  addTags(frontmatter, post.tags);
  addOptional(frontmatter, "videoUrl", post.videoUrl);
  addOptional(frontmatter, "venue", post.venue);
  addOptional(frontmatter, "duration", post.duration);

  return `---\n${renderFrontmatter(frontmatter)}---\n\n${postBodyWithSubtitle(post).trim()}\n`;
}

// ---------------------------------------------------------------------------
// Parsing: the inverse of renderPostMarkdownFile.
//
// Grammar (v1, deliberately line-oriented): an optional leading "---" line
// opens frontmatter, a matching "---" line closes it, everything after is the
// markdown body. Each frontmatter line is "key: value" where value is either
// a JSON scalar/array/object on ONE line (what render emits) or bare text
// (what a human types in a plain editor: `title: My Post`). Multi-line and
// block YAML (indented lists, folded scalars) are NOT supported in v1; such
// lines throw rather than silently eating data. A file with no leading "---",
// or an unterminated one, parses as all body.
// ---------------------------------------------------------------------------

export type ParsedPostFields = Partial<
  Pick<
    Post,
    | "title"
    | "slug"
    | "type"
    | "status"
    | "excerpt"
    | "date"
    | "accent"
    | "cover"
    | "coverCaption"
    | "coverHeight"
    | "pinned"
    | "starred"
    | "gallery"
    | "links"
    | "tags"
    | "videoUrl"
    | "venue"
    | "duration"
  >
>;

export type ParsedPostMarkdownFile = {
  fields: ParsedPostFields;
  body: string;
  unknownKeys: string[];
};

const FRONTMATTER_LINE_RE = /^([A-Za-z][A-Za-z0-9_-]*):\s?(.*)$/;

// Keys render emits that carry no post state; recognized, never "unknown".
// `folder`/`folderName` are legacy (superseded by `workspace`), kept here so an
// older file round-trips without flagging them as unknown.
const METADATA_KEYS = [
  "schema",
  "workspace",
  "folder",
  "folderName",
  "mode",
  "canonical",
  "syncRevision",
];

const POST_TYPE_BY_VOCAB: Record<string, PostType> = {
  article: "article",
  project: "project",
  talk: "talk",
  note: "note",
  bookmark: "bookmark",
  media_post: "project",
  video_post: "talk",
};

export function parsePostMarkdownFile(fileText: string): ParsedPostMarkdownFile {
  // Strip a leading BOM (the Windows Notepad default) so it cannot hide the
  // opening "---" and silently demote the whole frontmatter block to body.
  const text = fileText.replace(/^\uFEFF/, "");
  const split = splitFrontmatter(text);
  if (!split) return { fields: {}, body: text, unknownKeys: [] };

  const fields: ParsedPostFields = {};
  const unknownKeys: string[] = [];
  let kindType: PostType | undefined;
  let typeType: PostType | undefined;

  for (const line of split.lines) {
    if (!line.trim()) continue;
    const match = FRONTMATTER_LINE_RE.exec(line);
    if (!match) {
      throw new Error(
        `Unsupported frontmatter line (only single-line "key: value" pairs): ${line.trim()}`,
      );
    }
    const key = match[1];
    const raw = match[2].trim();
    if (!raw) continue;
    const value = parseScalar(raw);

    switch (key) {
      case "title":
      case "excerpt":
      case "cover":
      case "coverCaption":
      case "videoUrl":
      case "venue":
      case "duration": {
        const text = fieldText(value, key);
        if (text) fields[key] = text;
        break;
      }
      case "slug": {
        const slug = sanitizePostSlug(fieldText(value, key), "");
        if (slug) fields.slug = slug;
        break;
      }
      case "kind":
        kindType = fieldPostType(value, key);
        break;
      case "type":
        typeType = fieldPostType(value, key);
        break;
      case "status":
        fields.status = fieldStatus(value);
        break;
      case "date":
        fields.date = fieldDate(value);
        break;
      case "accent":
        // "" is the explicit opt-out; only undefined means "not present".
        fields.accent = fieldAccent(value);
        break;
      case "coverHeight":
        fields.coverHeight = fieldFiniteInt(value, key);
        break;
      case "pinned":
        fields.pinned = fieldBoolean(value, key);
        break;
      case "starred":
        fields.starred = fieldBoolean(value, key);
        break;
      case "gallery":
        fields.gallery = fieldGallery(value);
        break;
      case "links":
        fields.links = fieldLinks(value);
        break;
      case "tags":
        fields.tags = fieldTags(value);
        break;
      default:
        if (!METADATA_KEYS.includes(key)) unknownKeys.push(key);
    }
  }

  const type = typeType ?? kindType;
  if (type) fields.type = type;
  const subtitle = markdownSubtitle(split.body);
  if (subtitle) fields.excerpt = subtitle;

  return { fields, body: split.body, unknownKeys };
}

function splitFrontmatter(
  fileText: string,
): { lines: string[]; body: string } | null {
  if (!/^---\r?\n/.test(fileText)) return null;

  const lines: string[] = [];
  let cursor = fileText.indexOf("\n") + 1;
  while (cursor <= fileText.length) {
    const nextBreak = fileText.indexOf("\n", cursor);
    const rawLine =
      nextBreak === -1 ? fileText.slice(cursor) : fileText.slice(cursor, nextBreak);
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    // Trailing whitespace on the closing delimiter is a human artifact
    // (gray-matter tolerates it too); an opening "---" never carries any.
    if (/^---\s*$/.test(line)) {
      const bodyStart = nextBreak === -1 ? fileText.length : nextBreak + 1;
      // Render puts one blank separator line before the body; eat any.
      const body = fileText.slice(bodyStart).replace(/^(?:\r?\n)+/, "");
      return { lines, body };
    }
    if (nextBreak === -1) break;
    lines.push(line);
    cursor = nextBreak + 1;
  }
  return null;
}

function parseScalar(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function fieldText(value: unknown, key: string): string {
  if (typeof value !== "string") throw new Error(`${key} must be text`);
  return value.trim();
}

function fieldPostType(value: unknown, key: string): PostType {
  if (typeof value === "string") {
    const type = POST_TYPE_BY_VOCAB[value.trim()];
    if (type) return type;
  }
  throw new Error(
    `${key} must be one of article, project, talk, note, bookmark, media_post, video_post`,
  );
}

function fieldStatus(value: unknown): Post["status"] {
  if (value === "draft" || value === "published") return value;
  throw new Error(`status must be "draft" or "published"`);
}

function fieldDate(value: unknown): string {
  const date = fieldText(value, "date");
  if (Number.isNaN(new Date(date).getTime())) {
    throw new Error("date must be a parseable date");
  }
  return date;
}

function fieldAccent(value: unknown): string {
  const accent = fieldText(value, "accent");
  if (!accent) return "";
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) {
    throw new Error("accent must be a hex color like #065ec6");
  }
  return accent;
}

function fieldFiniteInt(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  return Math.round(value);
}

function fieldBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${key} must be true or false`);
  return value;
}

function fieldGallery(value: unknown): GalleryItem[] {
  if (!Array.isArray(value)) throw new Error("gallery must be a list");
  const items: GalleryItem[] = [];
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`gallery item ${index + 1} must be an object`);
    }
    const values = entry as Record<string, unknown>;
    const src = fieldOptionalText(values.src, `gallery item ${index + 1} src`);
    if (!src) continue;
    const caption = fieldOptionalText(
      values.caption,
      `gallery item ${index + 1} caption`,
    );
    const poster = fieldOptionalText(
      values.poster,
      `gallery item ${index + 1} poster`,
    );
    const item: GalleryItem = { src };
    if (caption) item.caption = caption;
    if (poster) item.poster = poster;
    items.push(item);
  }
  return items;
}

function fieldLinks(value: unknown): LinkRef[] {
  if (!Array.isArray(value)) throw new Error("links must be a list");
  const links: LinkRef[] = [];
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`link ${index + 1} must be an object`);
    }
    const values = entry as Record<string, unknown>;
    const href = fieldOptionalText(values.href, `link ${index + 1} href`);
    if (!href) continue;
    if (!isSafeLinkHref(href)) {
      throw new Error(`link ${index + 1} href must be a web, mail, or in-site URL`);
    }
    const label = fieldOptionalText(values.label, `link ${index + 1} label`);
    links.push({ label: label || href, href });
  }
  return links;
}

function fieldTags(value: unknown): string[] {
  if (typeof value !== "string" && !Array.isArray(value)) {
    throw new Error("tags must be a list or comma-separated text");
  }
  return normalizeTags(value);
}

function fieldOptionalText(value: unknown, key: string): string | undefined {
  if (value == null) return undefined;
  return fieldText(value, key) || undefined;
}

/**
 * The slug for a newly created file: an explicit slug wins, else it derives
 * from the title, else the caller's fallback (the placeholder draft slug).
 * Sync and MCP creates use this so "My Great Note.md" with a title never
 * ships as untitled-xxxx.
 */
export function slugForNewFile(
  fields: Pick<ParsedPostFields, "slug" | "title">,
  fallback: string,
): string {
  if (fields.slug) return fields.slug;
  return fields.title
    ? sanitizePostSlug(fields.title, fallback)
    : sanitizePostSlug(fallback, "post");
}

function addOptional(
  target: Record<string, unknown>,
  key: string,
  value: string | undefined,
) {
  const cleaned = value?.trim();
  if (cleaned) target[key] = cleaned;
}

function addOptionalNumber(
  target: Record<string, unknown>,
  key: string,
  value: number | undefined,
) {
  if (typeof value === "number" && Number.isFinite(value)) target[key] = value;
}

function cleanCover(value: string | undefined): string | undefined {
  if (!value || isNoCoverValue(value)) return undefined;
  return value;
}

function addGallery(
  target: Record<string, unknown>,
  gallery: GalleryItem[] | undefined,
) {
  if (!gallery || gallery.length === 0) return;
  target.gallery = gallery.map((item) => ({
    src: item.src,
    ...(item.caption ? { caption: item.caption } : {}),
    ...(item.poster ? { poster: item.poster } : {}),
  }));
}

function addLinks(target: Record<string, unknown>, links: LinkRef[] | undefined) {
  if (!links || links.length === 0) return;
  target.links = links.map((link) => ({
    label: link.label,
    href: link.href,
  }));
}

function addTags(target: Record<string, unknown>, tags: string[] | undefined) {
  const normalized = normalizeTags(tags);
  if (normalized.length > 0) target.tags = normalized;
}

function renderFrontmatter(values: Record<string, unknown>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}: ${yamlValue(value)}`)
    .join("\n")
    .concat("\n");
}

function yamlValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
