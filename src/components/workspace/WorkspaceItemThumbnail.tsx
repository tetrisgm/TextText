"use client";

import type { Post, ItemKind } from "@/lib/content";
import { isVideoFile } from "@/lib/content";
import { resolveCoverSource } from "@/lib/cover";
import type { WorkspacePoolPost } from "@/lib/pool/types";

function ItemTypeIcon({ type }: { type: ItemKind }) {
  if (type === "bookmark") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M6 3.5h8v13l-4-2.6-4 2.6v-13Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "note") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M5 3.5h7l3 3v10H5v-13Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8 9h4M8 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "video_post") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="3.5" y="5" width="13" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="m8.5 8 4 2-4 2V8Z" fill="currentColor" />
      </svg>
    );
  }
  if (type === "media_post") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="3.5" y="4" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="m6 13 3-3 2 2 1.5-1.5L15 13" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 3.5h7l3 3v10H5v-13Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 3.5v3h3M8 10h4M8 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Whether a post's thumbnail will be the type icon rather than a picture.
 *
 * The row's CSS used to ask this with `:has(.workspace-item-thumbnail.is-icon)`
 * in six places, which makes every list row's style depend on its own subtree
 * and re-resolve as the subtree changes. The component already knows, so it
 * says so on an attribute instead.
 */
export function thumbnailIsIcon(post: Post | WorkspacePoolPost): boolean {
  const source = resolveCoverSource({
    ...post,
    body: "body" in post ? post.body : (post.bodyPreview ?? ""),
  });
  return !source.src || source.kind === "none" || source.kind === "fallback";
}

export function WorkspaceItemThumbnail({
  post,
}: {
  post: Post | WorkspacePoolPost;
}) {
  const source = resolveCoverSource({
    ...post,
    body: "body" in post ? post.body : (post.bodyPreview ?? ""),
  });
  if (!source.src || source.kind === "none" || source.kind === "fallback") {
    return (
      <span className={`workspace-item-thumbnail is-icon is-${post.type}`} aria-hidden="true">
        <ItemTypeIcon type={post.type} />
      </span>
    );
  }
  if (isVideoFile(source.src)) {
    return (
      <span className="workspace-item-thumbnail" aria-hidden="true">
        <video src={source.src} muted playsInline preload="metadata" />
      </span>
    );
  }
  return (
    <span className="workspace-item-thumbnail" aria-hidden="true">
      {/* User media can be remote, so plain img avoids the image allowlist. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={source.src}
        alt=""
        decoding="async"
        loading="lazy"
        onError={(event) => {
          event.currentTarget.hidden = true;
          event.currentTarget.parentElement?.classList.add("is-broken");
        }}
      />
      <span className="workspace-item-thumbnail-fallback">
        <ItemTypeIcon type={post.type} />
      </span>
    </span>
  );
}
