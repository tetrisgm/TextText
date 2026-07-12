import { markdownFileHash } from "@/lib/content-hash";
import { renderFolderManifest } from "@/lib/markdown-files";
import {
  getAccessibleFolderPostFiles,
  getAccessibleFolders,
} from "@/lib/store";
import { resolveSyncWorkspace } from "../../../auth";
import {
  ifNoneMatchSatisfied,
  syncError,
  syncManifestOptions,
} from "../../../sync";

interface Props {
  params: Promise<{ folderId: string }>;
}

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: Props) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;
  const { blog } = workspace;

  // The folder must belong to THIS workspace; a foreign or unknown id is 404.
  const { folderId } = await params;
  const folders = await getAccessibleFolders(blog.handle, workspace);
  const folder = folders.find((entry) => entry.id === folderId);
  if (!folder) return syncError(404, "Folder not found");

  // Drafts included: the manifest is the owner's machine view of the whole
  // folder, unlike the public folder.json. `exact` scopes to THIS folder's
  // direct children only, so a post filed in a subfolder is listed by that
  // subfolder's manifest and never double-listed under the blog root. A post
  // without a folderId (not yet backfilled) counts as living in the blog root.
  const posts = (
    await getAccessibleFolderPostFiles(blog.handle, folder.path, workspace, {
      exact: true,
    })
  ).filter((post) => Boolean(post.id));
  const manifest = renderFolderManifest(
    blog,
    posts,
    syncManifestOptions(blog, folder),
  );

  const json = JSON.stringify(manifest, null, 2);
  const etag = `"${markdownFileHash(json)}"`;
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatchSatisfied(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return new Response(json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ETag: etag,
    },
  });
}
