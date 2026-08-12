import { postOgImage } from "@/lib/og-image";
import { publicFolderPath } from "@/lib/public-paths";
import { getBlog, resolvePublicPostPath } from "@/lib/store";

interface Props {
  params: Promise<{ handle: string; path: string[] }>;
}

export async function GET(_request: Request, { params }: Props) {
  const { handle, path } = await params;
  if (path.length < 2) return new Response("Not found", { status: 404 });
  const slug = path.at(-1) ?? "";
  const folderPath = path.slice(0, -1).join("/");
  if (publicFolderPath(folderPath) !== folderPath) {
    return new Response("Not found", { status: 404 });
  }
  const [blog, resolution] = await Promise.all([
    getBlog(handle),
    resolvePublicPostPath(handle, folderPath, slug),
  ]);
  if (!blog || resolution.kind !== "exact") {
    return new Response("Not found", { status: 404 });
  }
  return postOgImage(blog, resolution.post);
}
