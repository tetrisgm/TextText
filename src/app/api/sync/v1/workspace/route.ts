import { getFolders } from "@/lib/store";
import { resolveSyncWorkspace } from "../auth";
import { WORKSPACE_SCHEMA } from "../sync";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;
  const { blog } = workspace;

  const folders = await getFolders(blog.handle);
  return Response.json({
    schema: WORKSPACE_SCHEMA,
    blog: {
      handle: blog.handle,
      username: blog.username ?? null,
      name: blog.name,
      homeLayout: blog.homeLayout,
      cardStyle: blog.cardStyle,
    },
    folders: folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      path: folder.path,
      mode: folder.mode,
    })),
  });
}
