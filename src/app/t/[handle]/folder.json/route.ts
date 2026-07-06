import { notFound, publishedNewestFirst } from "@/lib/agent-surface";
import { renderFolderManifest } from "@/lib/markdown-files";
import { getBlog, getPosts } from "@/lib/store";

interface Props {
  params: Promise<{ handle: string }>;
}

export async function GET(_request: Request, { params }: Props) {
  const { handle } = await params;
  const [blog, posts] = await Promise.all([getBlog(handle), getPosts(handle)]);
  if (!blog) return notFound();

  return new Response(
    JSON.stringify(renderFolderManifest(blog, publishedNewestFirst(posts)), null, 2),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );
}
