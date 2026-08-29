import type { WorkspaceToolName } from "@/lib/ai/tools";

/**
 * What a destructive proposal will actually do, frozen when it is staged.
 *
 * A proposal is only a confirmation if the owner is shown something they can
 * recognise. Ids are not that: "delete 8e185487-8ac0-47de-90d5-3e9d84817fb8"
 * asks a person to approve a string. Titles, folders and whether a thing is
 * public are what someone can actually judge.
 *
 * Frozen, not recomputed at approval, for two reasons. It is what the person
 * saw and agreed to, so it is the honest record of what they consented to. And
 * each entry carries the revision the item was at, so approval can ask whether
 * the world still matches what was shown and refuse the ones that moved.
 */
export type FrozenItemPreview = {
  id: string;
  title: string;
  folderPath: string;
  /** "public" matters: approving the deletion of something people can see is
   *  a different decision from approving a draft. */
  visibility: "public" | "private";
  /** The optimistic-lock token at staging time. Drift means refuse. */
  revision: number | null;
  desiredStatus?: "draft" | "published";
  /** Set when the item could not be resolved at staging at all. */
  missing?: true;
};

export type FrozenProposalPreview = {
  kind: "items";
  tool: WorkspaceToolName;
  items: FrozenItemPreview[];
};

/** The sentence the owner is shown, built from the frozen preview. */
export function describeFrozenPreview(preview: FrozenProposalPreview): string {
  const present = preview.items.filter((item) => !item.missing);
  const missing = preview.items.filter((item) => item.missing);
  const publicOnes = present.filter((item) => item.visibility === "public");
  const status = present[0]?.desiredStatus;
  const lines = [
    status
      ? `${present.length === 1 ? "Change" : "Change the status of "}${present.length === 1 ? `\"${present[0].title}\"` : `${present.length} items`} to ${status === "published" ? "published" : "draft"}.`
      : null,
    !status && present.length === 1
      ? `Move "${present[0].title}" to Trash, from ${present[0].folderPath}.`
      : `Move ${present.length} items to Trash: ${present
          .map((item) => `"${item.title}"`)
          .join(", ")}.`,
    !status && publicOnes.length
      ? `${publicOnes.length} of them ${publicOnes.length === 1 ? "is" : "are"} published and will stop being visible.`
      : "",
    missing.length
      ? `${missing.length} could not be found and will be skipped.`
      : "",
    !status ? "Everything moved to Trash stays restorable." : "The owner can review this audience change before it runs.",
  ];
  return lines.filter(Boolean).join(" ");
}

/**
 * Whether the world still matches what the owner was shown.
 *
 * Approving a preview of five drafts must not delete five things that are now
 * published, or five things someone else has since edited. Any drift on an
 * item removes that item from the approval rather than failing the whole
 * thing: the other four are still what the person agreed to.
 */
export function driftedItems(
  frozen: FrozenProposalPreview,
  now: Map<
    string,
    { title: string; folderPath: string; visibility: string; revision: number | null }
  >,
): string[] {
  const drifted: string[] = [];
  for (const item of frozen.items) {
    if (item.missing) continue;
    const current = now.get(item.id);
    if (!current) {
      // Gone since staging. Not drift to refuse over: the outcome the person
      // wanted has already happened.
      continue;
    }
    if (
      current.revision !== item.revision ||
      current.visibility !== item.visibility ||
      current.title !== item.title ||
      // The folder was shown and so was approved. A rename or a move changes
      // what "from notes" meant when the person read it.
      current.folderPath !== item.folderPath
    ) {
      drifted.push(item.id);
    }
  }
  return drifted;
}
