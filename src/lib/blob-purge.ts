/**
 * Removing a deleted workspace's files from blob storage.
 *
 * Two passes, because neither alone is complete.
 *
 * The first deletes every URL reachable from a row. That is the accurate set,
 * and it is the only way to reach a file whose path does not carry the handle.
 *
 * The second sweeps by prefix, because /editor/upload writes to
 * `editor/media/{handle}/{date}/{file}` with no post scoping: an image pasted
 * into a document and later removed from it is orphaned immediately, reachable
 * from no row, and the first pass cannot see it.
 *
 * Both passes are best effort and neither throws. Row deletion must never
 * depend on blob storage being reachable, or a storage outage would leave a
 * person unable to delete their account. What it must not do is run late:
 * handles are released on delete and can be taken again, so a prefix sweep
 * after the blogs row is gone could belong to somebody else.
 */

const DELETE_CHUNK = 100;
// Paging guard. A workspace that needs more than this has something wrong with
// it, and looping forever against a paid API is the worse failure.
const MAX_LIST_PAGES = 200;

type BlobPurgeResult = {
  deleted: number;
  failed: number;
  swept: number;
};

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

/**
 * Every prefix this workspace's files can live under. The trailing slash is
 * load-bearing: without it `documents/ramine/` would also match
 * `documents/ramine-two/`, which is a different person's workspace.
 */
function workspaceBlobPrefixes(handle: string): string[] {
  const raw = handle;
  const safe = safeSegment(handle);
  const prefixes = new Set([
    `documents/${raw}/`,
    `captures/${raw}/`,
    `editor/media/${safe}/`,
  ]);
  return [...prefixes];
}

export async function purgeWorkspaceBlobs({
  handle,
  urls,
  token,
}: {
  handle: string;
  urls: string[];
  token: string | undefined;
}): Promise<BlobPurgeResult> {
  const result: BlobPurgeResult = { deleted: 0, failed: 0, swept: 0 };
  if (!token) return result;

  let blob: typeof import("@vercel/blob");
  try {
    blob = await import("@vercel/blob");
  } catch (error) {
    console.warn("blob purge unavailable", error);
    return result;
  }

  // Pass 1: everything a row pointed at.
  for (let i = 0; i < urls.length; i += DELETE_CHUNK) {
    const chunk = urls.slice(i, i + DELETE_CHUNK);
    try {
      await blob.del(chunk, { token });
      result.deleted += chunk.length;
    } catch (error) {
      result.failed += chunk.length;
      console.warn("workspace blob deletion failed", error);
    }
  }

  // Pass 2: everything under this workspace's prefixes, row or no row.
  for (const prefix of workspaceBlobPrefixes(handle)) {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      let listed: Awaited<ReturnType<typeof blob.list>>;
      try {
        listed = await blob.list({ prefix, cursor, token });
      } catch (error) {
        console.warn(`blob sweep failed for ${prefix}`, error);
        break;
      }
      // Re-check the prefix on every path before deleting it. The trailing
      // slash already makes a neighbouring handle impossible; this is the
      // cheap second belt on an irreversible call.
      const paths = listed.blobs
        .filter((entry) => entry.pathname.startsWith(prefix))
        .map((entry) => entry.url);
      for (let i = 0; i < paths.length; i += DELETE_CHUNK) {
        const chunk = paths.slice(i, i + DELETE_CHUNK);
        try {
          await blob.del(chunk, { token });
          result.swept += chunk.length;
        } catch (error) {
          result.failed += chunk.length;
          console.warn("blob sweep deletion failed", error);
        }
      }
      if (!listed.hasMore) break;
      cursor = listed.cursor;
    }
  }

  return result;
}
