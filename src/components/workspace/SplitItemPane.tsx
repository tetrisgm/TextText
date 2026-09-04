"use client";

import { useEffect, useState } from "react";
import { UnifiedDocumentReader } from "@/components/document/UnifiedDocumentReader";
import {
  ensurePostDocument,
  getCachedWorkspacePostDocument,
} from "@/lib/pool/store";
import { templateForPoolPost } from "@/lib/pool/selectors";
import type {
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";
import { closeSplit } from "@/lib/workspace/split-view";

/**
 * The item held open beside the one being worked on. It READS: the document
 * being edited already owns a collaborative session, and a second editable
 * surface on the same page would mean a second provider and a second undo
 * stack for no gain over opening the item properly.
 */
export function SplitItemPane({
  pool,
  post,
}: {
  pool: WorkspacePoolPayload;
  post: WorkspacePoolPost;
}) {
  const [document, setDocument] = useState(
    () => getCachedWorkspacePostDocument(post.blogId, post.id)?.document ?? null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedWorkspacePostDocument(post.blogId, post.id);
    if (cached) {
      setDocument(cached.document);
      return;
    }
    setDocument(null);
    setFailed(false);
    void ensurePostDocument(post.blogId, post.id)
      .then(() => {
        if (cancelled) return;
        const next = getCachedWorkspacePostDocument(post.blogId, post.id);
        if (next) setDocument(next.document);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [post.blogId, post.id]);

  return (
    <aside className="workspace-split-pane" aria-label="Item open beside">
      <header className="workspace-split-header">
        <span className="workspace-split-title">
          {post.title?.trim() || "Untitled"}
        </span>
        <button
          type="button"
          className="ac-btn ac-btn-gray workspace-split-close"
          onClick={closeSplit}
        >
          Close
        </button>
      </header>
      <div className="workspace-split-body">
        {document ? (
          <UnifiedDocumentReader
            blog={pool.blog}
            post={{
              ...post,
              body: document.content.body ?? "",
              document,
            }}
            template={templateForPoolPost(pool, post)}
          />
        ) : failed ? (
          <p className="workspace-split-empty">This item could not be opened.</p>
        ) : (
          <p className="workspace-split-empty">Opening…</p>
        )}
      </div>
    </aside>
  );
}
