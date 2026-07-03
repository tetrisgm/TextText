import type { Post } from "@/lib/content";
import {
  blogBaseUrl,
  notFound,
  oneLine,
  postIsoDate,
  postUrl,
} from "@/lib/agent-surface";
import { getBlog, getPost } from "@/lib/store";

interface Props {
  params: Promise<{ handle: string; slug: string }>;
}

export async function GET(_request: Request, { params }: Props) {
  const { handle, slug } = await params;
  const [blog, post] = await Promise.all([
    getBlog(handle),
    getPost(handle, slug),
  ]);
  if (!blog || !post || post.status !== "published") return notFound();

  return new Response(renderPostMarkdown(post, blogBaseUrl(handle)), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}

function renderPostMarkdown(post: Post, baseUrl: string): string {
  const lines = [`# ${oneLine(post.title)}`, ""];
  if (post.excerpt) lines.push(`Excerpt: ${oneLine(post.excerpt)}`);
  const date = postIsoDate(post);
  if (date) lines.push(`Date: ${date}`);
  lines.push(`Canonical: ${postUrl(baseUrl, post.slug)}`);

  return `${lines.join("\n")}\n\n${post.body}`;
}
