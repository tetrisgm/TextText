import { describe, expect, it } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { inventoryLegacyWorkspace, legacyInventoryDigest, type LegacyInventoryRow, type VaultInventoryRow } from "./legacy-inventory";
const source = (id = "a"): LegacyInventoryRow => ({ id, revision: 17, contentDigest: "digest", comments: 0, grants: 0, assets: [] });
const target = (itemId = "a"): VaultInventoryRow => ({ itemId, relativePath: `${itemId}.textpack`, revision: "independent-revision", contentDigest: "digest" });
describe("read-only legacy workspace inventory", () => {
  it("preserves identities and independent revisions and recognizes missing/matching/divergent", () => {
    const result = inventoryLegacyWorkspace({ legacy: [source(), source("b"), source("c")], vault: [target(), { ...target("c"), contentDigest: "other" }, target("extra")] });
    expect(result.items.map((item) => item.status)).toEqual(["matching", "missing", "divergent"]);
    expect(result.items[0].sources[0].revision).toBe(17);
    expect(result.items[0].destinations[0].revision).toBe("independent-revision");
    expect(result.vaultOnly[0].itemId).toBe("extra");
  });
  it("never treats revision agreement or absent content evidence as equality", () => {
    expect(inventoryLegacyWorkspace({ legacy: [source()], vault: [{ ...target(), revision: "17", contentDigest: undefined }] }).items[0].status).toBe("unverified");
  });
  it("flags duplicate identity and case-insensitive path collisions", () => {
    for (const vault of [[target(), { ...target(), relativePath: "other.textpack" }], [target(), { ...target("other"), relativePath: "A.textpack" }]]) {
      expect(inventoryLegacyWorkspace({ legacy: [source()], vault }).items[0].status).toBe("duplicate");
    }
    expect(inventoryLegacyWorkspace({ legacy: [source(), source()], vault: [] }).items[0].status).toBe("duplicate");
  });
  it("reports comments, grants, unavailable assets, and unknown evidence without mutation", () => {
    const input = { legacy: [{ ...source(), comments: 2, grants: 1, assets: [{ id: "lost", available: false }, { id: "unknown", available: null }] }], vault: [target()], manifestProblems: [{ relativePath: "bad", reason: "invalid" }] };
    const before = structuredClone(input);
    const result = inventoryLegacyWorkspace(input);
    expect(result.items[0].blockers).toEqual(["asset-not-inspected:unknown", "asset-unavailable:lost", "comments-require-migration", "grants-require-migration"]);
    result.items[0].sources[0].revision = 99;
    expect(input).toEqual(before);
    expect(result.manifestProblems).toEqual(input.manifestProblems);
    expect(result.readOnly).toBe(true);
  });
  it("does not resurrect tombstones or hide source trash/publication requirements", () => {
    expect(inventoryLegacyWorkspace({ legacy: [source()], vault: [{ ...target(), deleted: true }] }).items[0].blockers).toContain("destination-deleted");
    expect(inventoryLegacyWorkspace({ legacy: [{ ...source(), deleted: true, visibility: "public", comments: null, grants: null, assets: null }], vault: [] }).items[0].blockers).toEqual(["assets-not-inspected", "comments-not-inspected", "grants-not-inspected", "publication-requires-migration", "source-deleted"]);
  });
  it("canonicalizes object keys but keeps changed asset URLs and content distinct", () => {
    const doc = emptyDocumentSnapshot();
    expect(legacyInventoryDigest(doc)).toBe(legacyInventoryDigest(JSON.parse(JSON.stringify(doc))));
    const changed = structuredClone(doc); changed.content.body = "changed";
    expect(legacyInventoryDigest(changed)).not.toBe(legacyInventoryDigest(doc));
    expect(() => legacyInventoryDigest({})).toThrow();
  });
});
