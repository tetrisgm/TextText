import {
  blogBaseUrl,
  folderJsonUrl,
  locatedPostMarkdownUrl,
  locatedPostUrl,
  llmsTxtUrl,
  notFound,
  postIsoDate,
  publishedNewestFirst,
} from "@/lib/agent-surface";
import {
  itemKindForPostType,
  markdownFilePathForPost,
} from "@/lib/markdown-files";
import { getBlog, getPublicPostLocations } from "@/lib/store";

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
  const listing = {
    blog: {
      handle: blog.handle,
      name: blog.name,
      author: blog.author,
      tagline: blog.tagline ?? null,
      url: baseUrl,
      folder_json_url: folderJsonUrl(baseUrl),
      llms_txt_url: llmsTxtUrl(baseUrl),
    },
    posts: publishedNewestFirst(locations.map((location) => location.post)).map((post) => {
      const location = locations.find((candidate) => candidate.post.id === post.id)!;
      const date = postIsoDate(post);
      return {
        slug: post.slug,
        kind: itemKindForPostType(post.type),
        file: markdownFilePathForPost(post),
        title: post.title,
        excerpt: post.excerpt ?? null,
        ...(date ? { date } : {}),
        canonical_url: locatedPostUrl(baseUrl, location),
        markdown_url: locatedPostMarkdownUrl(baseUrl, location),
      };
    }),
  };

  return new Response(JSON.stringify(listing, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
