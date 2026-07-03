"use client";

import { useEffect, useState } from "react";
import { Reader } from "@/components/Reader";
import type { Blog, Post } from "@/lib/content";

type DraftState = {
  blog: Blog;
  post: Post;
};

type DraftMessage = {
  type?: string;
  blog?: Blog;
  post?: Post;
};

export default function EditorPreviewPage() {
  const [enabled] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("preview"),
  );
  const [draft, setDraft] = useState<DraftState | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as DraftMessage | null;
      if (data?.type !== "write-draft" || !data.blog || !data.post) return;
      setDraft({ blog: data.blog, post: data.post });
    };

    const announceReady = () => {
      try {
        window.parent?.postMessage(
          { type: "write-preview-ready" },
          window.location.origin,
        );
      } catch {
        return;
      }
    };

    window.addEventListener("message", onMessage);
    if (document.readyState === "complete") {
      announceReady();
    } else {
      window.addEventListener("load", announceReady, { once: true });
    }

    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("load", announceReady);
    };
  }, [enabled]);

  if (!enabled || !draft) return <main aria-hidden="true" />;

  return <Reader blog={draft.blog} post={draft.post} />;
}
