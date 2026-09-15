import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { feedConnections, folders } from "@/lib/db/schema";
import type { WorkspaceReadingSource } from "@/lib/pool/types";
import { workspaceIdForHandle } from "@/lib/store";

/**
 * The feed connections of a workspace in the shape the client pool carries.
 * One row per connection, so this stays small however many articles exist,
 * and it is what tells a folder page it is a reading scope without another
 * request.
 */
export async function listWorkspaceReadingSources(
  handle: string,
): Promise<WorkspaceReadingSource[]> {
  if (!db) return [];
  const blogId = await workspaceIdForHandle(handle);
  const rows = await db
    .select({
      id: feedConnections.id,
      folderId: feedConnections.folderId,
      folderPath: folders.path,
      state: feedConnections.state,
      health: feedConnections.health,
      healthDetail: feedConnections.healthDetail,
      lastSuccessAt: feedConnections.lastSuccessAt,
      publisherTitle: feedConnections.publisherTitle,
    })
    .from(feedConnections)
    .innerJoin(folders, eq(folders.id, feedConnections.folderId))
    .where(
      and(
        eq(feedConnections.blogId, blogId),
        isNull(feedConnections.deletedAt),
        isNull(folders.deletedAt),
      ),
    );
  return rows.map((row) => ({
    id: row.id,
    folderId: row.folderId,
    folderPath: row.folderPath,
    state: row.state as WorkspaceReadingSource["state"],
    health: row.health,
    healthDetail: row.healthDetail,
    lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.toISOString() : null,
    publisherTitle: row.publisherTitle,
  }));
}
