import type { Blog, Post } from "@/lib/content";
import { postBodyPreview } from "@/lib/content";
import {
  blogBaseUrl,
  folderJsonUrl,
  llmsTxtUrl,
  locatedPostMarkdownUrl,
  locatedPostUrl,
  markdownLinkText,
  notFound,
  oneLine,
  pipeDelimitedValue,
  plainTextSummary,
  postIsoDate,
  postsJsonUrl,
  publishedNewestFirst,
} from "@/lib/agent-surface";
import { getBlog, getPublicPostLocations } from "@/lib/store";
import type { PublicPostLocation } from "@/lib/store";

interface Props {
  params: Promise<{ handle: string }>;
}

export async function GET(_request: Request, { params }: Props) {
  const { handle } = await params;
  const [blog, locations] = await Promise.all([
    getBlog(handle),
    getPublicPostLocations(handle),
  ]);
  if (!blog) return notFound();

  const baseUrl = blogBaseUrl(blog);

  const posts = publishedNewestFirst(locations.map((location) => location.post));
  const orderedLocations = posts.map(
    (post) => locations.find((candidate) => candidate.post.id === post.id)!,
  );
  return new Response(renderLlmsTxt(blog, posts, orderedLocations, baseUrl), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}

function renderLlmsTxt(
  blog: Blog,
  posts: Post[],
  locations: PublicPostLocation[],
  baseUrl: string,
): string {
  const lines = [
    `# ${oneLine(blog.name)}`,
    "",
    `Author: ${oneLine(blog.author)}`,
  ];

  if (blog.tagline) lines.push(`Tagline: ${oneLine(blog.tagline)}`);

  lines.push(
    `Home: ${baseUrl}`,
    `Folder JSON: ${folderJsonUrl(baseUrl)}`,
    `LLMS: ${llmsTxtUrl(baseUrl)}`,
    `Posts JSON: ${postsJsonUrl(baseUrl)}`,
    "",
    "## Posts",
    "",
  );

  if (posts.length === 0) {
    lines.push("No published posts.");
  } else {
    for (const [index, post] of posts.entries()) {
      const location = locations[index]!;
      const date = postIsoDate(post);
      const fields = [
        `- [${pipeDelimitedValue(markdownLinkText(post.title))}](${locatedPostMarkdownUrl(baseUrl, location)})`,
      ];
      if (date) fields.push(`Date: ${date}`);
      fields.push(
        `Canonical: ${locatedPostUrl(baseUrl, location)}`,
        `Summary: ${pipeDelimitedValue(plainTextSummary(postBodyPreview(post)))}`,
      );
      lines.push(fields.join(" | "));
    }
  }

  return `${lines.join("\n")}\n`;
}
