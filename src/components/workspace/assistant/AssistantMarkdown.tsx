"use client";

// The assistant's Markdown renderer, in its own module so the workspace list
// does not parse it.
//
// react-markdown brings unified, micromark, mdast and hast with it - about
// 300KB across ~97 packages. The rail is closed by default and the list
// renders no Markdown at all, so none of that belongs on the path to the first
// paint. Kept beside AssistantConversation because it shares its stylesheet.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";
import styles from "./AssistantConversation.module.css";

/**
 * Provider text is untrusted Markdown. ReactMarkdown escapes raw HTML by
 * default; the image override also prevents a reply from loading a tracking
 * URL merely because it was rendered in the sidebar.
 */
// Module-level component map: inline functions here are new component types
// on every render, which unmounts and remounts their DOM (see the same fix in
// DocumentRenderer's Markdown).
const assistantMarkdownComponents = {
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  h1: ({ children }: { children?: ReactNode }) => <h3>{children}</h3>,
  h2: ({ children }: { children?: ReactNode }) => <h3>{children}</h3>,
  img: ({ alt }: { alt?: string }) => (
    <span className={styles.assistantImagePlaceholder}>
      {alt ? `Image: ${alt}` : "Image omitted"}
    </span>
  ),
};
const assistantMarkdownPlugins = [remarkGfm];

export function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className={styles.assistantMarkdown}>
      <ReactMarkdown
        remarkPlugins={assistantMarkdownPlugins}
        components={assistantMarkdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
