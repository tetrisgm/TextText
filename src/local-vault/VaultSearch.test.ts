import { describe, expect, it } from "vitest";
import { filterVaultSearchActions, type VaultSearchAction } from "./VaultSearch";

const actions: VaultSearchAction[] = [
  { id: "new", label: "New note", description: "Create a note in Projects" },
  { id: "capture", label: "Capture", description: "Save a link or note in Projects", keywords: ["bookmark"] },
  { id: "customize", label: "Customize this folder", description: "Change how Projects looks" },
];

describe("vault search actions", () => {
  it("shows the concise action list before a query", () => {
    expect(filterVaultSearchActions(actions, "").map((action) => action.id)).toEqual(["new", "capture", "customize"]);
  });

  it("matches action labels, descriptions, and everyday aliases", () => {
    expect(filterVaultSearchActions(actions, "new note").map((action) => action.id)).toEqual(["new"]);
    expect(filterVaultSearchActions(actions, "bookmark").map((action) => action.id)).toEqual(["capture"]);
    expect(filterVaultSearchActions(actions, "projects looks").map((action) => action.id)).toEqual(["customize"]);
  });
});
