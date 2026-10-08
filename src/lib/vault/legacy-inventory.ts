import { createHash } from "node:crypto";
import { requireDocumentSnapshot } from "@/lib/documents/model";
import { stableJson } from "@/lib/documents/sync";

/** Both sources must use this digest; ZIP hashes and revision counters are not comparable. */
export function legacyInventoryDigest(document: unknown): string {
  return createHash("sha256").update(stableJson(requireDocumentSnapshot(document, "Reconciliation inventory"))).digest("hex");
}
export type LegacyInventoryRow = {
  id: string; revision: number | string; contentDigest?: string;
  comments: number | null; grants: number | null;
  assets: readonly { id: string; available: boolean | null }[] | null;
  deleted?: boolean; slug?: string; slugHistory?: readonly string[]; folderId?: string; visibility?: string;
};
export type VaultInventoryRow = {
  itemId: string; relativePath: string; revision: string; contentDigest?: string; deleted?: boolean;
};
/** Pure captured-input report. No discovery, repair, writes, or cutover authorization. */
export function inventoryLegacyWorkspace(input: {
  legacy: readonly LegacyInventoryRow[]; vault: readonly VaultInventoryRow[];
  manifestProblems?: readonly { relativePath: string; reason: string }[];
}) {
  const ids = new Set(input.legacy.map((row) => row.id));
  const items = [...ids].sort().map((id) => {
    const sources = input.legacy.filter((row) => row.id === id);
    const destinations = input.vault.filter((row) => row.itemId === id);
    const blockers = new Set<string>();
    for (const source of sources) {
      if (source.comments === null) blockers.add("comments-not-inspected");
      else if (source.comments > 0) blockers.add("comments-require-migration");
      if (source.grants === null) blockers.add("grants-not-inspected");
      else if (source.grants > 0) blockers.add("grants-require-migration");
      if (source.assets === null) blockers.add("assets-not-inspected");
      else for (const asset of source.assets) if (asset.available !== true) {
        blockers.add(`asset-${asset.available === false ? "unavailable" : "not-inspected"}:${asset.id}`);
      }
      if (source.deleted) blockers.add("source-deleted");
      if (source.visibility === "public") blockers.add("publication-requires-migration");
    }
    const duplicatePath = destinations.some((row) => input.vault.some((other) =>
      other.itemId !== id && other.relativePath.toLowerCase() === row.relativePath.toLowerCase()));
    let status: "missing" | "matching" | "divergent" | "duplicate" | "unverified";
    if (sources.length !== 1 || destinations.length > 1 || duplicatePath) status = "duplicate";
    else if (!destinations.length) status = "missing";
    else if (destinations[0].deleted && !sources[0].deleted) {
      status = "divergent"; blockers.add("destination-deleted");
    } else if (!sources[0].contentDigest || !destinations[0].contentDigest) {
      status = "unverified"; blockers.add("content-not-compared");
    } else status = sources[0].contentDigest === destinations[0].contentDigest && Boolean(sources[0].deleted) === Boolean(destinations[0].deleted) ? "matching" : "divergent";
    return { id, status, sources: structuredClone(sources), destinations: structuredClone(destinations), blockers: [...blockers].sort() };
  });
  return { items, vaultOnly: structuredClone(input.vault.filter((row) => !ids.has(row.itemId))), manifestProblems: structuredClone(input.manifestProblems ?? []), readOnly: true as const };
}
