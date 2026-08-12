import { blogBaseUrl, locatedPostUrl, notFound } from "@/lib/agent-surface";
import { renderPostMarkdownFile } from "@/lib/markdown-files";
import { publicFolderPath } from "@/lib/public-paths";
import { getBlog, resolvePublicPostPath } from "@/lib/store";

interface Props {
  params: Promise<{ handle: string; path: string[] }>;
}

export async function GET(_request: Request, { params }: Props) {
  const { handle, path } = await params;
  if (path.length < 2) return notFound();
  const slug = path.at(-1) ?? "";
  const folderPath = path.slice(0, -1).join("/");
  if (publicFolderPath(folderPath) !== folderPath) return notFound();
  const [blog, resolution] = await Promise.all([
    getBlog(handle),
    resolvePublicPostPath(handle, folderPath, slug),
  ]);
  if (!blog || resolution.kind === "missing") return notFound();
  const baseUrl = blogBaseUrl(blog);
  const destination = locatedPostUrl(baseUrl, resolution);
  if (resolution.kind === "redirect") {
    return new Response(null, {
      status: 307,
      headers: {
        Location: `${destination}/index.md`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  return new Response(
    renderPostMarkdownFile({
      blog,
      canonicalUrl: destination,
      includePersonalMetadata: false,
      post: resolution.post,
    }),
    { headers: { "Content-Type": "text/markdown; charset=utf-8" } },
  );
}
