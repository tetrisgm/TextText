import { blogBaseUrl, notFound, postUrl } from "@/lib/agent-surface";
import { renderPostMarkdownFile } from "@/lib/markdown-files";
import { getBlog, resolvePostSlug } from "@/lib/store";

interface Props {
  params: Promise<{ handle: string; slug: string }>;
}

export async function GET(request: Request, { params }: Props) {
  const { handle, slug } = await params;
  const [blog, resolution] = await Promise.all([
    getBlog(handle),
    resolvePostSlug(handle, slug),
  ]);
  const post =
    resolution.kind === "exact" || resolution.kind === "history"
      ? resolution.post
      : null;
  if (
    !blog ||
    !post ||
    post.type === "note" ||
    post.type === "bookmark" ||
    post.status !== "published"
  ) {
    return notFound();
  }

  if (resolution.kind === "history") {
    const target = new URL(request.url);
    target.pathname = target.pathname.replace(
      /\/[^/]+\/index\.md$/,
      `/${encodeURIComponent(post.slug)}/index.md`,
    );
    target.search = "";
    return new Response(null, {
      status: 307,
      headers: {
        Location: target.toString(),
        "Cache-Control": "private, no-store",
      },
    });
  }

  const baseUrl = blogBaseUrl(blog);
  return new Response(
    renderPostMarkdownFile({
      blog,
      canonicalUrl: postUrl(baseUrl, post.slug),
      includePersonalMetadata: false,
      post,
    }),
    {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
      },
    },
  );
}
