import { unzipSync, strFromU8 } from "fflate";
import type { FolderViewMetadata } from "./folder-view";

/** Ordinary files carry no cached body/assets. Recognized definitions remain strict downstream. */
export function extractFolderViewMetadata(bytes: Uint8Array, path: string, hash: string): FolderViewMetadata | null {
  if (bytes.length > 64 * 1024 * 1024) throw new Error("Folder view file exceeds limits");
  let entries: Record<string, Uint8Array>;
  try {
    let expanded = 0;
    entries = unzipSync(bytes, { filter(entry) {
      if (!/(?:^|\/)(document|template)\.json$/.test(entry.name)) return false;
      if ((expanded += entry.originalSize) > 4 * 1024 * 1024) throw new Error("Folder view metadata exceeds limits");
      return true;
    } });
  } catch (error) {
    if (error instanceof Error && error.message.includes("exceeds limits")) throw error;
    return null;
  }
  const documents = Object.keys(entries).filter(key => /(?:^|\/)document\.json$/.test(key));
  if (documents.length !== 1) return null;
  const key = documents[0], documentJSON = strFromU8(entries[key]);
  let document;
  try { document = JSON.parse(documentJSON); } catch { return null; }
  if (document?.content?.fields?.texttextFolderView === undefined) return null;
  const template = entries[key.replace(/document\.json$/, "template.json")];
  return { path, hash, documentJSON, ...(template ? { templateJSON: strFromU8(template) } : {}) };
}

/** Bounded LRU: cache identity is supplied by the native file fingerprint or content hash. */
export class FolderViewMetadataCache {
  private entries = new Map<string, { fingerprint: string; value: FolderViewMetadata | null; weight: number }>();
  private weight = 0;
  get(key: string, fingerprint: string): FolderViewMetadata | null | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key); this.weight -= entry.weight;
    if (entry.fingerprint !== fingerprint) return undefined;
    this.entries.set(key, entry); this.weight += entry.weight;
    return entry.value;
  }
  put(key: string, fingerprint: string, value: FolderViewMetadata | null) {
    const previous = this.entries.get(key);
    if (previous) { this.weight -= previous.weight; this.entries.delete(key); }
    const weight = 2 * (key.length + fingerprint.length + (value?.documentJSON?.length ?? 0) + (value?.templateJSON?.length ?? 0));
    if (weight > 16 * 1024 * 1024) return;
    this.entries.set(key, { fingerprint, value, weight }); this.weight += weight;
    while (this.entries.size > 16_384 || this.weight > 16 * 1024 * 1024) {
      const oldest = this.entries.keys().next().value!;
      this.weight -= this.entries.get(oldest)!.weight; this.entries.delete(oldest);
    }
  }
  clear() { this.entries.clear(); this.weight = 0; }
}
