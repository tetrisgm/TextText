import { describe, expect, it } from "vitest";
import { readVaultLocation, resolveVaultLocation, writeVaultLocation } from "./vault-location";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

describe("vault location", () => {
  it("stores a location separately for each workspace", () => {
    const storage = memoryStorage();
    writeVaultLocation(storage, "/Writing", { folder: "Drafts", path: "Drafts/Essay.textpack" });
    writeVaultLocation(storage, "/Reading", { folder: "Inbox" });

    expect(readVaultLocation(storage, "/Writing")).toEqual({ folder: "Drafts", path: "Drafts/Essay.textpack" });
    expect(readVaultLocation(storage, "/Reading")).toEqual({ folder: "Inbox" });
  });

  it("restores an existing item in its actual folder", () => {
    expect(resolveVaultLocation(
      { folder: "Old name", path: "Projects/Plan.textpack" },
      ["Projects/Plan.textpack"],
      ["Projects"],
    )).toEqual({ folder: "Projects", path: "Projects/Plan.textpack" });
  });

  it("falls back to an existing folder when the item was removed", () => {
    expect(resolveVaultLocation(
      { folder: "Projects", path: "Projects/Removed.textpack" },
      ["Projects/Plan.textpack"],
      ["Projects"],
    )).toEqual({ folder: "Projects" });
  });

  it("falls back to the workspace root for stale or malformed state", () => {
    const storage = memoryStorage();
    storage.setItem("texttext:vault-location:/Writing", JSON.stringify({ folder: "Bad\nfolder" }));
    expect(readVaultLocation(storage, "/Writing")).toBeNull();
    expect(resolveVaultLocation({ folder: "Removed" }, [], ["Notes"])).toEqual({ folder: "" });
  });
});
