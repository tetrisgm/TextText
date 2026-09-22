"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DocumentCollectionRenderer } from "@/components/document/DocumentRenderer";
import { TagChips } from "@/components/TagChips";
import { useCaptureStatus } from "@/components/bookmarks/useCaptureStatus";
import { WorkspaceItemActions, WorkspaceItemStar } from "./WorkspaceItemActions";
import { collectionItemPreview } from "@/lib/presentation/collection-item-preview";
import { formatArticleDate, type Blog, type Post } from "@/lib/content";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import { blogPostPath } from "@/lib/public-paths";
import { isNewTabClick } from "@/lib/workspace/selection-modifiers";
import { shouldSuppressNativeItemSelection } from "@/lib/workspace-selection";
import styles from "./FolderCollectionItem.module.css";

type Props = {
  blog: Blog;
  handle: string;
  post: Post;
  template: TemplateDefinition;
  selected: boolean;
  optionId?: string;
  tabIndex: number;
  owner: boolean;
  onSelect?: () => void;
  onOpenPost?: (post: Post) => void;
  onOpenPostInNewTab?: (id: string) => void;
  onItemClick?: (event: MouseEvent<HTMLElement>) => boolean;
  onDragItems?: (transfer: DataTransfer, id: string) => void;
  onOpenTag?: (tag: string) => void;
  onDeleteItem?: (post: Post) => Promise<void> | void;
  onCaptureResolved?: (post: Post) => void;
};

/** One interaction shell for every item, independent of the folder's default type. */
export function FolderCollectionItem({ blog, handle, post, template, selected, optionId,
  tabIndex, owner, onSelect, onOpenPost, onOpenPostInNewTab, onItemClick,
  onDragItems, onOpenTag, onDeleteItem, onCaptureResolved }: Props) {
  const router = useRouter();
  const captureStatus = useCaptureStatus(post.id, post.captureStatus, {
    onResolved: (status, snapshot) => {
      if (onCaptureResolved) onCaptureResolved({ ...post, captureStatus: status,
        capture: snapshot.capture ?? post.capture, cover: snapshot.cover ?? post.cover,
        updatedAt: snapshot.updatedAt ?? post.updatedAt, wordCount: snapshot.wordCount ?? post.wordCount });
      else router.refresh();
    },
  });
  const preview = useMemo(() => collectionItemPreview(post, template), [post, template]);
  const href = blogPostPath(blog, post);
  const date = formatArticleDate(post.updatedAt ?? post.date, { style: "short" });
  const [now, setNow] = useState(() => Date.now());
  const captureStarted = new Date(post.updatedAt ?? post.date ?? "").getTime();
  const recentlyPending = captureStatus === "pending" && Number.isFinite(captureStarted) && now - captureStarted < 600_000;
  useEffect(() => {
    if (!recentlyPending) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, captureStarted + 600_000 - Date.now()));
    return () => clearTimeout(timer);
  }, [captureStarted, recentlyPending]);
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (post.id && onOpenPostInNewTab && isNewTabClick(event)) {
      event.preventDefault(); onOpenPostInNewTab(post.id); return;
    }
    if (onItemClick && !onItemClick(event)) { event.preventDefault(); return; }
    if (onOpenPost && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault(); onOpenPost(post);
    }
  };
  return <div id={optionId} className={styles.item}
    role="option" aria-label={post.title.trim() || "Untitled"} aria-selected={selected} tabIndex={tabIndex} data-workspace-post-id={post.id} onFocus={onSelect}>
    <WorkspaceItemStar handle={handle} owner={owner} post={post} />
    <Link className={styles.link} href={href} aria-label={post.title.trim() || "Untitled"}
      title="Open · Command click: new tab · Option click: add to selection · Shift click: extend"
      prefetch={onOpenPost ? false : undefined} draggable={selected}
      onDragStart={(event) => { if (post.id) onDragItems?.(event.dataTransfer, post.id); }}
      onMouseDown={(event) => { if (shouldSuppressNativeItemSelection(event)) event.preventDefault(); }}
      onClick={open} onAuxClick={(event) => {
        if (event.button === 1 && post.id && onOpenPostInNewTab) { event.preventDefault(); onOpenPostInNewTab(post.id); }
      }}>
      <DocumentCollectionRenderer document={preview.document} template={template}
        documentId={`collection-${post.id ?? post.slug}`} metadata={{ date }} slots={preview.slots} preview />
      {preview.excerpt && <p className={styles.excerpt}>{preview.excerpt}</p>}
      <span className={styles.meta}>{preview.host ? `${preview.host} · ` : ""}{date}</span>
    </Link>
    {recentlyPending ? <span className={styles.status} role="status">Capturing…</span> : captureStatus === "failed" ? <span className={styles.status}>Capture failed</span> : null}
    <TagChips blog={blog} tags={post.tags} onOpenTag={onOpenTag} />
    <WorkspaceItemActions blog={blog} handle={handle} href={href} owner={owner} post={post} onDeletePost={onDeleteItem} />
  </div>;
}
