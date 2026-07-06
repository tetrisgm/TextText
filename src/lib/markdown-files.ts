import type { Blog, GalleryItem, ItemKind, LinkRef, Post, PostType } from "@/lib/content";
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
};

export type MarkdownFolderManifest = {
  schema: typeof WRITE_FOLDER_SCHEMA;
  folder: {
    handle: string;
    name: string;
    mode: typeof DEFAULT_FOLDER_MODE;
    views: typeof BLOG_FOLDER_VIEWS;
    itemKinds: typeof BLOG_ITEM_KINDS;
  };
  items: MarkdownFolderItem[];
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
): MarkdownFolderManifest {
  return {
    schema: WRITE_FOLDER_SCHEMA,
    folder: {
      handle: blog.handle,
      name: blog.name,
      mode: DEFAULT_FOLDER_MODE,
      views: BLOG_FOLDER_VIEWS,
      itemKinds: BLOG_ITEM_KINDS,
    },
    items: posts.map((post) => ({
      file: markdownFilePathForPost(post),
      kind: itemKindForPostType(post.type),
      slug: post.slug,
      title: post.title,
      status: post.status,
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
  addOptional(frontmatter, "date", post.date);
  addOptional(frontmatter, "canonical", canonicalUrl);
  addOptional(frontmatter, "accent", post.accent);
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
