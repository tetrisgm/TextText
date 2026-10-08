import { describe, expect, it } from "vitest";
import { locateVaultItem } from "./item-location";
import type { VaultListing } from "./bridge";
const listing = (items: VaultListing["items"]): VaultListing => ({ root: "workspace", items });
describe("open document location", () => {
  it("follows identity through a move even when the old path is reused", () => {
    expect(locateVaultItem("one", listing([{ itemId: "other", path: "Notes/Old.textpack" },
      { itemId: "one", path: "Archive/New.textpack", canEditContent: false }])))
      .toEqual({ itemId: "one", path: "Archive/New.textpack", canEditContent: false });
  });
  it("refuses missing, duplicate and unidentified files", () => {
    expect(locateVaultItem(null, listing([{ path: "Notes/One.textpack" }]))).toBeNull();
    expect(locateVaultItem("one", listing([{ itemId: "other", path: "Notes/One.textpack" }]))).toBeNull();
    expect(locateVaultItem("one", listing([{ itemId: "one", path: "A" }, { itemId: "one", path: "B" }]))).toBeNull();
    expect(locateVaultItem("one", listing([{ itemId: "one", path: "A" }, { itemId: "other", path: "A" }]))).toBeNull();
  });
});
