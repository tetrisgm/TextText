import type { WorkspacePoolPost } from "@/lib/pool/types";

export type TimelineFilter = "all" | "writing" | "saved";
export type TimelineEntry = {
  id: string;
  at: string;
  kind: "created" | "saved" | "published";
  post: WorkspacePoolPost;
};
export type TimelinePage = {
  entries: TimelineEntry[];
  nextCursor: string | null;
  snapshot: string;
};
