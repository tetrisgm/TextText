import { parsePostMarkdownFile } from "@/lib/markdown-files";
import { createDraft, deletePost, savePost } from "@/lib/store";
import { resolveSyncWorkspace } from "../auth";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import { clientSaveError, syncError, syncManifestItem } from "../sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;
  const { blog } = workspace;

  let parsed: ReturnType<typeof parsePostMarkdownFile>;
  try {
    parsed = parsePostMarkdownFile(await request.text());
  } catch (error) {
    return syncError(400, errorMessage(error, "Could not parse the file"));
  }

  const created = await createDraft(blog.handle, parsed.fields.type ?? "article");
  try {
    // date comes from the file alone: created.date is the placeholder's
    // derived createdAt, and letting it through would backdate a publish to
    // midnight today instead of savePost stamping now.
    const saved = await savePost(blog.handle, {
      ...created,
      ...parsed.fields,
      date: parsed.fields.date,
      slug: parsed.fields.slug ?? created.slug,
      body: parsed.body,
    });
    revalidateBlogPaths(blog, [saved.slug]);
    return Response.json({ item: syncManifestItem(blog, saved) }, { status: 201 });
  } catch (error) {
    // Best effort: never strand the placeholder draft behind a failed save
    // (e.g. the file's slug is already used).
    if (created.id) await deletePost(blog.handle, created.id).catch(() => {});
    const message = clientSaveError(error);
    if (message) return syncError(400, message);
    throw error; // internal failure: surface as 500, never a false 400
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
