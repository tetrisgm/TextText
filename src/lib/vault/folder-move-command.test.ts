import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freezeFolderMoveReview } from "./folder-move-review";
import { planFolderMove } from "@/sync/engine/folder-move-plan";

const store = vi.hoisted(() => ({
  getBlogEditRecord: vi.fn(), getUserIdBySub: vi.fn(),
  moveVaultFolder: vi.fn(), previewVaultFolderMove: vi.fn(),
}));
vi.mock("@/lib/store", () => store);
import { executeApprovedFolderMove } from "./folder-move-command.server";

describe("reviewed folder move attribution", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TEXTTEXT_VAULT_ROOT", "/test/vault");
    store.getBlogEditRecord.mockResolvedValue({ id: "workspace", ownerId: "owner" });
    store.getUserIdBySub.mockResolvedValue("owner");
    store.moveVaultFolder.mockResolvedValue({ status: "folder_moved" });
  });
  it.each(["human", "ai", "external_agent"] as const)("records %s with the correct durable actor", async actorType => {
    const review = freezeFolderMoveReview(planFolderMove({ source: "Source", destination: "Archive/Moved",
      manifestRevision: "a".repeat(64), folders: ["Source", "Archive"], items: [], grants: [] }));
    await executeApprovedFolderMove({ sub: "subject", userId: "owner", handle: "owner", actorType },
      { source_path: "Source", destination_path: "Archive/Moved", idempotency_key: "review" },
      { review, accessAcknowledged: false });
    expect(store.moveVaultFolder).toHaveBeenCalledWith(expect.objectContaining({
      actorType: actorType === "human" ? "human" : "external_agent", actorUserId: "owner",
    }));
  });
});
