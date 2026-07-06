import {
  blogBaseUrl,
  folderJsonUrl,
  llmsTxtUrl,
  notFound,
  postIsoDate,
  postMarkdownUrl,
  postUrl,
  publishedNewestFirst,
} from "@/lib/agent-surface";
import {
  itemKindForPostType,
  markdownFilePathForPost,
} from "@/lib/markdown-files";
import { getBlog, getPosts } from "@/lib/store";

interface Props {
  params: Promise<{ handle: string }>;
}

export async function GET(_request: Request, { params }: Props) {
  const { handle } = await params;
  const [blog, posts] = await Promise.all([getBlog(handle), getPosts(handle)]);
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
    posts: publishedNewestFirst(posts).map((post) => {
      const date = postIsoDate(post);
      return {
        slug: post.slug,
        kind: itemKindForPostType(post.type),
        file: markdownFilePathForPost(post),
        title: post.title,
        excerpt: post.excerpt ?? null,
        ...(date ? { date } : {}),
        canonical_url: postUrl(baseUrl, post.slug),
        markdown_url: postMarkdownUrl(baseUrl, post.slug),
      };
    }),
  };

  return new Response(JSON.stringify(listing, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
