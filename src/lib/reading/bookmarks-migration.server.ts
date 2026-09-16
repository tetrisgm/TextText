import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { posts } from "@/lib/db/schema";
import type { AuditActorType } from "@/lib/audit";
import { createDraftInFolder, createSubfolder, getFolders, setPostCreatedAt, workspaceIdForHandle } from "@/lib/store";
import { canonicalizeUrl } from "./feed-identity";
import { buildBookmarksHtml, parseBookmarksHtml, type HtmlBookmark } from "./bookmarks-html";

/**
 * Migration in and out of the bookmarks people already have.
 *
 * Import turns a browser or Pinboard export into ordinary saved bookmarks
 * (manual origin: they are the person's own, never pass through), keeping
 * the original save date, tags, and description, and recreating the
 * export's folders under the chosen bookmarks folder. Links already saved
 * are skipped by canonical address, so a second import adds nothing twice.
 */

export type ImportReport = { added: number; skipped: number; failed: number; folders: number; considered: number };

const PER_REQUEST = 500;

function requireDb() {
  if (!db) throw new Error("Bookmark migration needs DATABASE_URL");
  return db;
}

async function existingCanonicalUrls(blogId: string): Promise<Set<string>> {
  const rows = await requireDb()
    .select({ document: posts.document })
    .from(posts)
    .where(and(eq(posts.blogId, blogId), isNull(posts.deletedAt), eq(posts.type, "bookmark")));
  const urls = new Set<string>();
  for (const row of rows) {
    const source = (row.document as { content?: { fields?: { sourceUrl?: unknown } } }).content?.fields?.sourceUrl;
    if (typeof source === "string") {
      const canonical = canonicalizeUrl(source);
      if (canonical) urls.add(canonical);
    }
  }
  return urls;
}

export async function importBookmarksHtml(input: {
  handle: string;
  html: string;
  parentFolderPath: string;
  actor: { userId: string | null; actorType: AuditActorType };
}): Promise<ImportReport> {
  const bookmarks = parseBookmarksHtml(input.html);
  const blogId = await workspaceIdForHandle(input.handle);
  const folders = await getFolders(input.handle);
  const parent = folders.find((folder) => folder.path === input.parentFolderPath && folder.mode === "bookmarks");
  if (!parent) throw new Error("Choose a bookmarks folder to import into");
  const existing = await existingCanonicalUrls(blogId);
  const folderIdByPath = new Map(folders.map((folder) => [folder.path, folder.id]));
  const report: ImportReport = { added: 0, skipped: 0, failed: 0, folders: 0, considered: Math.min(bookmarks.length, PER_REQUEST) };
  const audit = { actorUserId: input.actor.userId, actorType: input.actor.actorType, targetType: "item" as const };

  const folderFor = async (bookmark: HtmlBookmark): Promise<string> => {
    if (!bookmark.folder) return parent.id;
    let path = parent.path;
    for (const name of bookmark.folder.split("/").map((part) => part.trim()).filter(Boolean)) {
      const candidate = `${path}/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "folder"}`;
      let id = folderIdByPath.get(candidate);
      if (!id) {
        const created = await createSubfolder(input.handle, path, name, {
          audit: { ...audit, targetType: "folder", actionName: "reading.import_bookmarks_folder", inputSummary: candidate },
        });
        id = created.id;
        folderIdByPath.set(created.path, created.id);
        path = created.path;
        report.folders += 1;
      } else {
        path = candidate;
      }
    }
    return folderIdByPath.get(path) ?? parent.id;
  };

  for (const bookmark of bookmarks.slice(0, PER_REQUEST)) {
    const canonical = canonicalizeUrl(bookmark.url);
    if (!canonical || existing.has(canonical)) {
      report.skipped += 1;
      continue;
    }
    try {
      const folderId = await folderFor(bookmark);
      const post = await createDraftInFolder(input.handle, folderId, {
        initial: {
          type: "bookmark",
          title: bookmark.title,
          excerpt: bookmark.description ?? undefined,
          body: bookmark.description ? `${bookmark.description}\n\n[Original](${bookmark.url})` : `[Original](${bookmark.url})`,
          links: [{ label: new URL(bookmark.url).hostname, href: bookmark.url }],
          tags: bookmark.tags,
        },
        audit: { ...audit, actionName: "reading.import_bookmark", inputSummary: bookmark.url.slice(0, 200) },
      });
      if (post.id && bookmark.addedAt && !Number.isNaN(bookmark.addedAt.getTime())) {
        await setPostCreatedAt(input.handle, post.id, bookmark.addedAt);
      }
      existing.add(canonical);
      report.added += 1;
    } catch {
      report.failed += 1;
    }
  }
  return report;
}

/** The person's own saved bookmarks (never feed imports), as a Netscape file. */
export async function exportBookmarksHtml(input: { handle: string; folderPath?: string | null }): Promise<string> {
  const blogId = await workspaceIdForHandle(input.handle);
  const folders = await getFolders(input.handle);
  const inScope = folders.filter((folder) => !input.folderPath || folder.path === input.folderPath || folder.path.startsWith(`${input.folderPath}/`));
  if (inScope.length === 0) return buildBookmarksHtml({ title: `${input.handle} bookmarks`, bookmarks: [] });
  const nameByFolderId = new Map(inScope.map((folder) => [folder.id, folder.name]));
  const rows = await requireDb()
    .select({ title: posts.title, document: posts.document, createdAt: posts.createdAt, folderId: posts.folderId, tags: posts.tags, excerpt: posts.excerpt })
    .from(posts)
    .where(and(eq(posts.blogId, blogId), isNull(posts.deletedAt), eq(posts.type, "bookmark"), eq(posts.origin, "manual"), inArray(posts.folderId, inScope.map((folder) => folder.id))))
    .orderBy(posts.createdAt)
    .limit(5000);
  const bookmarks = rows.flatMap((row) => {
    const url = (row.document as { content?: { fields?: { sourceUrl?: unknown } } }).content?.fields?.sourceUrl;
    if (typeof url !== "string" || !url) return [];
    return [{ url, title: row.title || url, addedAt: row.createdAt, tags: row.tags ?? [], folder: nameByFolderId.get(row.folderId) ?? "Bookmarks", description: row.excerpt ?? null }];
  });
  return buildBookmarksHtml({ title: `${input.handle} bookmarks`, bookmarks });
}
