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

export type WorkspacePoolPost = {
  id: string;
  blogId: string;
  folderId?: string;
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
  trashedPosts?: WorkspacePoolPost[];
  trashedFolders?: Folder[];
  sharedEntries?: SharedWithMeEntry[];
  /** Bodies worth warming with the workspace shell, currently every note. */
  initialBodies?: WorkspaceInitialBody[];
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
