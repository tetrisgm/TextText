import type {
  Blog,
  BookmarkCapture,
  CaptureStatus,
  Folder,
  GalleryItem,
  LinkRef,
  Post,
  PostType,
} from "@/lib/content";
import type { SharedWithMeEntry } from "@/lib/shares";
import type { WikiLinkReference } from "@/lib/wikilink-syntax";
import type { TemplateDefinition } from "@/lib/presentation/schema";

export type WorkspacePoolPost = {
  id: string;
  blogId: string;
  folderId?: string;
  /** Canonical content + presentation. Legacy fields below are list indexes. */
  document?: Post["document"];
  visibility?: Post["visibility"];
  template?: Post["template"];
  type: PostType;
  captureStatus?: CaptureStatus;
  capture?: BookmarkCapture;
  slug: string;
  title: string;
  excerpt?: string;
  bodyPreview?: string;
  accent?: string;
  cover?: string;
  coverCaption?: string;
  coverHeight?: number;
  gallery?: GalleryItem[];
  links?: LinkRef[];
  tags?: string[];
  videoUrl?: string;
  venue?: string;
  duration?: string;
  wordCount?: number;
  readingTime?: number;
  date?: string;
  publishedAt?: string;
  status: Post["status"];
  pinned?: boolean;
  starred?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type WorkspacePoolPayload = {
  version: 1;
  blogId: string;
  blog: Blog;
  folders: Folder[];
  counts: Record<string, number>;
  posts: WorkspacePoolPost[];
  /** Immutable template versions available to this workspace. */
  templates: TemplateDefinition[];
  trashedPosts?: WorkspacePoolPost[];
  trashedFolders?: Folder[];
  sharedEntries?: SharedWithMeEntry[];
  /** Bodies worth warming with the workspace shell, currently every note. */
  initialBodies?: WorkspaceInitialBody[];
  /** Full-body extraction keyed by source post id. */
  outboundLinks?: Record<string, WikiLinkReference[]>;
  /** Unambiguous historical slug to current slug mappings. */
  slugAliases?: Record<string, string>;
  fetchedAt: string;
};

export type WorkspacePostBodyPayload = {
  blogId: string;
  postId: string;
  body: string;
  updatedAt?: string;
  fetchedAt: string;
};

export type WorkspaceInitialBody = {
  postId: string;
  body: string;
  updatedAt?: string;
};
