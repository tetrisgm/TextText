import { expect, it } from "vitest";
import { FolderViewMetadataCache, extractFolderViewMetadata } from "./folder-view-metadata";
import { createFolderViewPack } from "./folder-view";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
it("caches absent markers without content, invalidates revision changes, and bounds entries", () => {
  const cache = new FolderViewMetadataCache();
  cache.put("Notes/A", "one", null);
  expect(cache.get("Notes/A", "one")).toBeNull();
  expect(cache.get("Notes/A", "two")).toBeUndefined();
  for (let i = 0; i < 16_385; i++) cache.put(String(i), "hash", null);
  expect(cache.get("0", "hash")).toBeUndefined();
  expect(cache.get("16384", "hash")).toBeNull();
  cache.clear(); expect(cache.get("16384", "hash")).toBeUndefined();
});
it("extracts recognized metadata without retaining archive entries and skips corrupt ordinary files", () => {
  const pack = createFolderViewPack("Notes", requireBuiltinTemplate("texttext.note"));
  const result = extractFolderViewMetadata(pack.bytes, pack.path, "hash");
  expect(Object.keys(result!).sort()).toEqual(["documentJSON", "hash", "path", "templateJSON"]);
  expect(extractFolderViewMetadata(new TextEncoder().encode("not a ZIP"), "Notes/Broken.textpack", "hash")).toBeNull();
});
