import type { Blog, Post } from "@/lib/content";
import {
  blogBaseUrl,
  llmsTxtUrl,
  markdownLinkText,
  notFound,
  oneLine,
  plainTextSummary,
  postIsoDate,
  postMarkdownUrl,
  postUrl,
  postsJsonUrl,
  publishedNewestFirst,
} from "@/lib/agent-surface";
import { getBlog, getPosts } from "@/lib/store";

interface Props {
  params: Promise<{ handle: string }>;
}

export async function GET(_request: Request, { params }: Props) {
  const { handle } = await params;
  const [blog, posts] = await Promise.all([getBlog(handle), getPosts(handle)]);
  if (!blog) return notFound();

  const baseUrl = blogBaseUrl(handle);

  return new Response(renderLlmsTxt(blog, publishedNewestFirst(posts), baseUrl), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}

function renderLlmsTxt(blog: Blog, posts: Post[], baseUrl: string): string {
  const lines = [
    `# ${oneLine(blog.name)}`,
    "",
    `Author: ${oneLine(blog.author)}`,
  ];

  if (blog.tagline) lines.push(`Tagline: ${oneLine(blog.tagline)}`);

  lines.push(
    `Home: ${baseUrl}`,
    `LLMS: ${llmsTxtUrl(baseUrl)}`,
    `Posts JSON: ${postsJsonUrl(baseUrl)}`,
    "",
    "## Posts",
    "",
  );

  if (posts.length === 0) {
    lines.push("No published posts.");
  } else {
    for (const post of posts) {
      lines.push(
        [
          `- [${markdownLinkText(post.title)}](${postMarkdownUrl(baseUrl, post.slug)})`,
          `Date: ${postIsoDate(post)}`,
          `Canonical: ${postUrl(baseUrl, post.slug)}`,
          `Summary: ${plainTextSummary(post.body)}`,
        ].join(" | "),
      );
    }
  }

  return `${lines.join("\n")}\n`;
}
