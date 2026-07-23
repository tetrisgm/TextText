import type { Blog, Post } from "@/lib/content";
import { documentFromLegacyPost } from "@/lib/documents/legacy";
import type { TemplateDefinition } from "@/lib/presentation/schema";
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
}: {
  blog: Blog;
  post: Post;
  template: TemplateDefinition;
}) {
  const document = post.document ?? documentFromLegacyPost(post);
  return (
    <DocumentRenderer
      document={document}
      documentId={post.id ?? post.slug}
      template={template}
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
