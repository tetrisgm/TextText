import type { DocumentSnapshot } from "@/lib/documents/model";

type Content = DocumentSnapshot["content"];
function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => same(value, right[index]));
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(key => same(a[key], b[key]));
}
function mergeFields<T extends object>(baseline: T, desired: T, current: T): T {
  const result = { ...current };
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(desired)]) as Set<keyof T>) {
    if (same(baseline[key], desired[key])) continue;
    if (!same(current[key], baseline[key]) && !same(current[key], desired[key])) throw new Error("These image details changed while you were editing. Your draft is kept. Reopen the details to review the latest version.");
    if (desired[key] === undefined) delete result[key];
    else result[key] = desired[key];
  }
  return result;
}

/** Merge only the viewer's metadata delta; the final write still uses the fresh
 * file revision to fence changes made after this read. */
export function mergeGalleryMetadata(baseline: Content, desired: Content, current: Content): Content {
  const { fields: beforeFields, assets: beforeAssets, ...before } = baseline;
  const { fields: nextFields, assets: nextAssets, ...next } = desired;
  const { fields: liveFields, assets: liveAssets, ...live } = current;
  if (beforeAssets.length !== nextAssets.length || beforeAssets.some((asset, index) => asset.id !== nextAssets[index].id || asset.src !== nextAssets[index].src || asset.kind !== nextAssets[index].kind)) throw new Error("The image metadata edit cannot replace image files.");
  const changed = beforeAssets.filter((asset, index) => !same(asset, nextAssets[index]));
  for (const asset of changed) {
    const matches = liveAssets.filter(candidate => candidate.id === asset.id);
    if (matches.length !== 1 || matches[0].src !== asset.src || matches[0].kind !== asset.kind) throw new Error("This image changed while you were editing. Your draft is kept. Reopen the image to review it.");
  }
  return { ...mergeFields(before, next, live), fields: mergeFields(beforeFields, nextFields, liveFields), assets: liveAssets.map(asset => {
    const index = beforeAssets.findIndex(candidate => candidate.id === asset.id);
    return index < 0 || same(beforeAssets[index], nextAssets[index]) ? asset : mergeFields(beforeAssets[index], nextAssets[index], asset);
  }) };
}
