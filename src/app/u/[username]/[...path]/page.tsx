import { notFound } from "next/navigation";
import { PostPageForHandle } from "@/app/t/[handle]/[slug]/page";
import { publicFolderPath } from "@/lib/public-paths";
import { getBlogByUsername } from "@/lib/store";

interface Props {
  params: Promise<{ username: string; path: string[] }>;
  searchParams?: Promise<{ edit?: string | string[]; id?: string | string[] }>;
}

export default async function UsernameWorkspacePost({
  params,
  searchParams,
}: Props) {
  const { username, path } = await params;
  if (path.length < 2) notFound();
  const slug = path.at(-1) ?? "";
  const folderPath = path.slice(0, -1).join("/");
  if (publicFolderPath(folderPath) !== folderPath) notFound();
  const blog = await getBlogByUsername(username).catch(() => null);
  if (!blog) notFound();
  return (
    <PostPageForHandle
      handle={blog.handle}
      canonicalUsernameRoute
      folderPath={folderPath}
      searchParams={searchParams}
      slug={slug}
    />
  );
}
