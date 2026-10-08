import { parseTextpack, buildTextpack } from "@/lib/github/textpack";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { replacePackIdentity } from "@/local-vault/pack";
import { ensureVaultFolders, listVaultTextpacks, writeVaultTextpack, type VaultLocation } from "./server-store";

export const STARTER_FOLDERS = ["Blog", "Bookmarks", "Gallery", "Notes", "Feeds"] as const;
const PRESETS = [{ id: "article", folder: "Blog" }, { id: "bookmark", folder: "Bookmarks" }, { id: "gallery", folder: "Gallery" }, { id: "note", folder: "Notes" }] as const;
export async function provisionFileWorkspace(location: VaultLocation, actorUserId: string, presetRoot = path.join(process.cwd(), "presets/builtin")) {
  // Load and validate every source before any mutation. The exact same packs ship on Mac.
  const prepared = await Promise.all(PRESETS.map(async preset => {
    const bytes = await readFile(path.join(presetRoot, `${preset.id}.textpack`));
    const pack = parseTextpack(bytes);
    const document = validateDocumentSnapshot(pack.document);
    const title = String(document.content.title).replace(/[\\/:\x00-\x1f]/g, "-").replace(/^[. ]+|[. ]+$/g, "") || "Untitled";
    const itemId = createHash("sha256").update(`starter-v1:${location.workspaceId}:${preset.id}`).digest("hex").slice(0, 32);
    return { itemId, relativePath: `${preset.folder}/${title}.textpack`, bytes: buildTextpack(preset.id, { ...pack, markdown: replacePackIdentity(pack.markdown, itemId) }) };
  }));
  await ensureVaultFolders(location, STARTER_FOLDERS);
  const manifest = await listVaultTextpacks(location);
  for (const item of prepared) {
    // A user edit, rename, or explicit deletion is authoritative on retries.
    if ([...manifest.items, ...manifest.tombstones].some(existing => existing.itemId === item.itemId)) continue;
    if (manifest.items.some(existing => existing.relativePath.toLowerCase() === item.relativePath.toLowerCase())) throw new Error("A starter path already contains another file");
    const result = await writeVaultTextpack({ ...location, ...item, operationId: `starter-v1-${item.itemId}`, baseRevision: null, audit: { actorUserId, actorType: "human" } });
    if (result.status !== "written") throw new Error("Workspace setup could not finish safely");
  }
}
