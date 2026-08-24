import { folderPathForPoolPost } from "@/lib/pool/selectors";
import type { WorkspacePoolPayload, WorkspacePoolPost } from "@/lib/pool/types";
import { blogWorkspacePostPath } from "@/lib/public-paths";

export type AssistantProofOperation =
  | "Appended"
  | "Created"
  | "Found"
  | "Moved"
  | "Moved to Trash"
  | "Opened"
  | "Read"
  | "Restored"
  | "Updated";

export type AssistantArtifactProof = {
  operation: AssistantProofOperation;
  itemId: string;
  title: string;
  /** The exact stored folder path. */
  folderPath: string;
  /** Present only when the item still resolves in the current workspace. */
  href?: string;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function postById(
  pool: WorkspacePoolPayload | null,
  id: string,
): WorkspacePoolPost | null {
  if (!pool || !id) return null;
  return (
    pool.posts.find((post) => post.id === id) ??
    pool.trashedPosts?.find((post) => post.id === id) ??
    null
  );
}

export function itemArtifactProof({
  folderPath,
  id,
  operation,
  pool,
  title,
  slug,
}: {
  folderPath?: string;
  id: string;
  operation: AssistantProofOperation;
  pool: WorkspacePoolPayload | null;
  title?: string;
  /** Validated command-result slug, used before a new item reaches the pool. */
  slug?: string;
}): AssistantArtifactProof | null {
  const post = postById(pool, id);
  const resolvedTitle = text(title) || post?.title.trim() || "Untitled";
  const resolvedFolder =
    text(folderPath) || (post && pool ? folderPathForPoolPost(pool, post) : "");
  if (!id || !resolvedFolder) return null;
  const resolvedSlug = post?.slug || text(slug);
  const trashed = pool?.trashedPosts?.some((entry) => entry.id === id);
  const href =
    pool && resolvedSlug && !trashed
      ? blogWorkspacePostPath(pool.blog, resolvedFolder, {
          slug: resolvedSlug,
        })
      : undefined;
  return {
    operation,
    itemId: id,
    title: resolvedTitle,
    folderPath: resolvedFolder,
    ...(href ? { href } : {}),
  };
}

/** Proof only for context bodies that the current turn actually loaded. */
export function loadedContextArtifactProofs(
  items: readonly { id: string; title: string }[],
  pool: WorkspacePoolPayload | null,
): AssistantArtifactProof[] {
  if (!pool) return [];
  return items.slice(0, 4).flatMap((item) => {
    const proof = itemArtifactProof({
      id: item.id,
      operation: "Read",
      pool,
      title: item.title,
    });
    return proof ? [proof] : [];
  });
}

/** A compact visible index proves discovery only, never a full-body read. */
export function compactWorkspaceIndexArtifactProofs(
  pool: WorkspacePoolPayload | null,
  limit = 12,
): AssistantArtifactProof[] {
  if (!pool) return [];
  return [...pool.posts]
    .sort((left, right) =>
      (right.updatedAt ?? right.createdAt ?? "").localeCompare(
        left.updatedAt ?? left.createdAt ?? "",
      ),
    )
    .slice(0, Math.max(1, limit))
    .flatMap((post) => {
      const proof = itemArtifactProof({
        id: post.id,
        operation: "Found",
        pool,
        title: post.title,
      });
      return proof ? [proof] : [];
    });
}

function proofFromRecord(
  value: unknown,
  operation: AssistantProofOperation,
  pool: WorkspacePoolPayload | null,
  fallbackFolder?: string,
): AssistantArtifactProof | null {
  const item = record(value);
  const id = text(item.id);
  if (!id) return null;
  return itemArtifactProof({
    folderPath: text(item.folder_path) || fallbackFolder,
    id,
    operation,
    pool,
    title: text(item.title),
    slug: text(item.slug),
  });
}

/**
 * Translate a completed workspace command into inspectable TextText proof.
 *
 * The proof is intentionally derived only from the validated command result
 * and the current workspace index. A model saying it created or read
 * something is not proof, so unsupported output returns an empty list.
 */
export function workspaceToolArtifactProofs({
  args,
  output,
  pool,
  tool,
}: {
  args: UnknownRecord;
  output: unknown;
  pool: WorkspacePoolPayload | null;
  tool: string;
}): AssistantArtifactProof[] {
  const result = record(output);
  const receipt = record(result.receipt);
  const fallbackFolder =
    text(result.folder_path) ||
    text(receipt.saved_to) ||
    text(args.folder_path);

  if (tool === "search") {
    const values = Array.isArray(result.results) ? result.results : [];
    return values
      .map((value) => proofFromRecord(value, "Found", pool, fallbackFolder))
      .filter((proof): proof is AssistantArtifactProof => Boolean(proof));
  }
  if (tool === "list_items") {
    const values = Array.isArray(result.items) ? result.items : [];
    return values
      // Listing proves discovery, not that the model opened the full body.
      // Keep exact source receipts reserved for read_item and explicitly
      // attached context so a compact index can never masquerade as evidence.
      .map((value) => proofFromRecord(value, "Found", pool, fallbackFolder))
      .filter((proof): proof is AssistantArtifactProof => Boolean(proof));
  }
  if (tool === "list_trash") {
    const values = Array.isArray(result.items) ? result.items : [];
    return values
      .map((value) => proofFromRecord(value, "Found", pool, fallbackFolder))
      .filter((proof): proof is AssistantArtifactProof => Boolean(proof));
  }

  const operation: AssistantProofOperation | null =
    tool === "read_item" ||
    tool === "review_brief_sources" ||
    tool === "list_comments" ||
    tool === "list_access"
      ? "Read"
      : tool === "open_item"
        ? "Opened"
        : tool === "create_item"
          ? "Created"
          : tool === "update_item" ||
              tool === "set_item_status" ||
              tool === "set_item_template" ||
              tool === "add_item_asset" ||
              tool === "remove_item_asset" ||
              tool === "recapture_bookmark" ||
              tool === "add_comment" ||
              tool === "set_comment_resolved" ||
              tool === "set_access" ||
              tool === "revoke_access"
            ? "Updated"
            : tool === "append_to_item"
              ? "Appended"
              : tool === "move_item"
                ? "Moved"
                : tool === "delete_item"
                  ? "Moved to Trash"
                  : tool === "restore_item"
                    ? "Restored"
                    : null;
  if (!operation) return [];

  const item = record(result.item);
  const id =
    text(result.id) ||
    text(item.id) ||
    text(receipt.item_id) ||
    text(args.id);
  const proof = itemArtifactProof({
    folderPath:
      text(result.folder_path) ||
      text(item.folder_path) ||
      fallbackFolder,
    id,
    operation,
    pool,
    title: text(result.title) || text(item.title) || text(receipt.title),
    slug: text(result.slug) || text(item.slug),
  });
  return proof ? [proof] : [];
}

export function mergeArtifactProofs(
  current: readonly AssistantArtifactProof[] | undefined,
  next: readonly AssistantArtifactProof[],
): AssistantArtifactProof[] {
  const merged: AssistantArtifactProof[] = [];
  const seen = new Set<string>();
  for (const proof of [...(current ?? []), ...next]) {
    const isRead = proof.operation === "Read" || proof.operation === "Found";
    const sameItemIndex = merged.findIndex(
      (candidate) =>
        candidate.itemId === proof.itemId &&
        candidate.folderPath === proof.folderPath,
    );
    if (sameItemIndex >= 0) {
      const existing = merged[sameItemIndex];
      const existingIsRead =
        existing.operation === "Read" || existing.operation === "Found";
      // A completed write is the stronger receipt for the same artifact. Do
      // not make the rail repeat that it first read the item it changed.
      if (existingIsRead && !isRead) {
        seen.delete(
          `${existing.operation}:${existing.itemId}:${existing.folderPath}`,
        );
        merged.splice(sameItemIndex, 1);
      } else if (!existingIsRead && isRead) {
        continue;
      } else if (existingIsRead && isRead) {
        // Discovery and an exact read are two evidence levels for one item,
        // not two separate receipts. Promote Found to Read in place and never
        // let a later compact-index result demote an exact read.
        if (existing.operation === "Found" && proof.operation === "Read") {
          seen.delete(
            `${existing.operation}:${existing.itemId}:${existing.folderPath}`,
          );
          merged[sameItemIndex] = proof;
          seen.add(`${proof.operation}:${proof.itemId}:${proof.folderPath}`);
        }
        continue;
      }
    }
    const key = `${proof.operation}:${proof.itemId}:${proof.folderPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(proof);
  }
  return merged;
}
