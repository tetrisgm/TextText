import { describe, expect, it, vi } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
const mock = vi.hoisted(() => ({ limit: vi.fn(), where: vi.fn(), from: vi.fn(), select: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: { select: mock.select }, executeAtomicBatch: vi.fn() }));
import { readLegacyWorkspaceInventory } from "@/lib/store";
describe("legacy inventory store loader", () => {
  it("reads one bounded snapshot and keeps deleted IDs plus unknown asset availability", async () => {
    mock.select.mockReturnValue({ from: mock.from }); mock.from.mockReturnValue({ where: mock.where }); mock.where.mockReturnValue({ limit: mock.limit });
    const document = emptyDocumentSnapshot();
    document.content.assets = [{ id: "asset", kind: "image", src: "https://example.com/image.png" }];
    mock.limit.mockResolvedValue([{ id: "legacy", revision: 42, document, folderId: "folder", slug: "old", slugHistory: ["older"], visibility: "private", deletedAt: new Date(), comments: 2, grants: 1 }]);
    const report = await readLegacyWorkspaceInventory({ workspaceId: "workspace", vault: [] });
    expect(mock.limit).toHaveBeenCalledWith(5001);
    expect(report.items[0].sources[0]).toMatchObject({ id: "legacy", revision: 42, deleted: true, slugHistory: ["older"] });
    expect(report.items[0].blockers).toContain("asset-not-inspected:asset");
    expect(report.items[0].blockers).toContain("comments-require-migration");
    expect(report.items[0].blockers).toContain("grants-require-migration");
  });
  it("fails closed instead of returning a partial oversized inventory", async () => {
    mock.limit.mockResolvedValue(Array(5001).fill({}));
    await expect(readLegacyWorkspaceInventory({ workspaceId: "workspace", vault: [] })).rejects.toThrow("exceeds 5000");
  });
});
