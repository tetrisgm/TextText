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
import { markdownFileHash } from "@/lib/content-hash";
import { isNoCoverValue } from "@/lib/cover";

export const WRITE_FOLDER_SCHEMA = "write.folder.v1";
export const WRITE_MARKDOWN_FILE_SCHEMA = "write.markdown-file.v1";
export const DEFAULT_FOLDER_MODE = "blog";
export const BLOG_FOLDER_VIEWS = ["timeline", "index", "grid", "single"] as const;
export const BLOG_ITEM_KINDS = ["article", "media_post", "video_post"] as const;

export type BlogItemKind = (typeof BLOG_ITEM_KINDS)[number];

export type MarkdownFolderItem = {
  file: string;
  kind: BlogItemKind;
  slug: string;
  title: string;
  status: Post["status"];
  /** database id; absent for demo/seed content */
  id?: string;
  date?: string;
  createdAt?: string;
  updatedAt?: string;
  /** public URL of the markdown file itself */
  url?: string;
  /** sha256 hex of the rendered markdown file, for cheap change detection */
  hash: string;
};

export type MarkdownFolderManifest = {
  schema: typeof WRITE_FOLDER_SCHEMA;
  folder: {
    handle: string;
    name: string;
    mode: FolderMode;
    views: typeof BLOG_FOLDER_VIEWS;
    itemKinds: typeof BLOG_ITEM_KINDS;
    activeView: BlogHomeLayout;
    id?: string;
    path?: string;
  };
  items: MarkdownFolderItem[];
};

export type RenderFolderManifestOptions = {
  folder?: Folder;
  /** public URL of the post's markdown file (index.md) */
  fileUrlFor?: (post: Post) => string;
  /** canonical public URL of the post, baked into each file's frontmatter */
  postUrlFor?: (post: Post) => string;
};

export function itemKindForPostType(type: PostType): BlogItemKind {
  if (type === "project") return "media_post";
  if (type === "talk") return "video_post";
  return "article";
}

export function postTypeForItemKind(kind: ItemKind): PostType {
  if (kind === "media_post") return "project";
  if (kind === "video_post") return "talk";
  return "article";
}

export function markdownFilePathForPost(post: Pick<Post, "slug">): string {
  return `posts/${post.slug}.md`;
}

export function renderFolderManifest(
  blog: Blog,
  posts: Post[],
  options?: RenderFolderManifestOptions,
): MarkdownFolderManifest {
  const folder = options?.folder;
  return {
    schema: WRITE_FOLDER_SCHEMA,
    folder: {
      handle: blog.handle,
      name: blog.name,
      mode: folder?.mode ?? DEFAULT_FOLDER_MODE,
      views: BLOG_FOLDER_VIEWS,
      itemKinds: BLOG_ITEM_KINDS,
      activeView: blog.homeLayout,
      ...(folder ? { id: folder.id, path: folder.path } : {}),
    },
    items: posts.map((post) => ({
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
      hash: markdownFileHash(
        renderPostMarkdownFile({
          blog,
          canonicalUrl: options?.postUrlFor?.(post),
          post,
        }),
      ),
    })),
  };
}

export function renderPostMarkdownFile({
  blog,
  canonicalUrl,
  post,
}: {
  blog: Blog;
  canonicalUrl?: string;
  post: Post;
}): string {
  const frontmatter: Record<string, unknown> = {
    schema: WRITE_MARKDOWN_FILE_SCHEMA,
    folder: blog.handle,
    folderName: blog.name,
    mode: DEFAULT_FOLDER_MODE,
    kind: itemKindForPostType(post.type),
    type: post.type,
    slug: post.slug,
    title: post.title,
    status: post.status,
  };

  addOptional(frontmatter, "excerpt", post.excerpt);
  // A draft's date is derived display state (createdAt, or the date of an
  // earlier publish), never authored: rendering it into the file would make a
  // later publish-by-file backdate the post instead of stamping now.
  if (post.status === "published") addOptional(frontmatter, "date", post.date);
  addOptional(frontmatter, "canonical", canonicalUrl);
  // An empty accent is a meaningful opt-out of the blog accent (postAccent in
  // content.ts), so it renders as accent: "" rather than disappearing.
  if (post.accent !== undefined) frontmatter.accent = post.accent;
  if (post.pinned) frontmatter.pinned = true;
  addOptional(frontmatter, "cover", cleanCover(post.cover));
  addOptional(frontmatter, "coverCaption", post.coverCaption);
  addOptionalNumber(frontmatter, "coverHeight", post.coverHeight);
  addGallery(frontmatter, post.gallery);
  addLinks(frontmatter, post.links);
  addOptional(frontmatter, "videoUrl", post.videoUrl);
  addOptional(frontmatter, "venue", post.venue);
  addOptional(frontmatter, "duration", post.duration);

  return `---\n${renderFrontmatter(frontmatter)}---\n\n${post.body.trim()}\n`;
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
    | "gallery"
    | "links"
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
const METADATA_KEYS = ["schema", "folder", "folderName", "mode", "canonical"];

const POST_TYPE_BY_VOCAB: Record<string, PostType> = {
  article: "article",
  project: "project",
  talk: "talk",
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
        const slug = slugify(fieldText(value, key));
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
      case "gallery":
        fields.gallery = fieldGallery(value);
        break;
      case "links":
        fields.links = fieldLinks(value);
        break;
      default:
        if (!METADATA_KEYS.includes(key)) unknownKeys.push(key);
    }
  }

  const type = typeType ?? kindType;
  if (type) fields.type = type;

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
    `${key} must be one of article, project, talk, media_post, video_post`,
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
    const label = fieldOptionalText(values.label, `link ${index + 1} label`);
    links.push({ label: label || href, href });
  }
  return links;
}

function fieldOptionalText(value: unknown, key: string): string | undefined {
  if (value == null) return undefined;
  return fieldText(value, key) || undefined;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
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
