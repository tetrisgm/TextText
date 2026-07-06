import { blogBaseUrl, notFound, postUrl } from "@/lib/agent-surface";
import { renderPostMarkdownFile } from "@/lib/markdown-files";
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

  const baseUrl = blogBaseUrl(blog);
  return new Response(
    renderPostMarkdownFile({
      blog,
      canonicalUrl: postUrl(baseUrl, post.slug),
      post,
    }),
    {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
      },
    },
  );
}
