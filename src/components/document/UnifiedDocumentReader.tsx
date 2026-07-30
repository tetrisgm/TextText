import type { Blog, Post } from "@/lib/content";
import { requireDocumentSnapshot } from "@/lib/documents/model";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import type { WikiLinkRenderTargets } from "@/lib/wikilinks";
import { DocumentRenderer } from "./DocumentRenderer";

function publishedDate(post: Post): string | undefined {
  const value = post.date ?? post.createdAt;
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return undefined;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function UnifiedDocumentReader({
  blog,
  post,
  template,
  wikiLinkTargets,
}: {
  blog: Blog;
  post: Post;
  template: TemplateDefinition;
  wikiLinkTargets?: WikiLinkRenderTargets;
}) {
  const document = requireDocumentSnapshot(
    post.document,
    `Item ${post.id ?? post.slug}`,
  );
  return (
    <DocumentRenderer
      document={document}
      documentId={post.id ?? post.slug}
      template={template}
      wikiLinkTargets={wikiLinkTargets}
      metadata={{
        author: blog.author,
        date: publishedDate(post),
        readingTime: post.readingTime
          ? `${post.readingTime} min read`
          : undefined,
      }}
    />
  );
}
