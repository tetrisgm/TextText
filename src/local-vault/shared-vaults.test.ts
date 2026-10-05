import { describe, expect, it } from "vitest";
import {
  canCreateInVaultFolder,
  canViewVaultFolder,
  parseSharedVaults,
  parseVaultAccess,
  sharedFileHref,
  sharedFolderHref,
  sharedVaultHashTarget,
  sharedVaultLinkTarget,
  sharedWorkspaceHref,
  type VaultAccess,
} from "./shared-vaults";

const workspaceId = "56129da8-7467-4876-b238-46d748c2c57b";
const scopedAccess: VaultAccess = {
  fullAccess: false,
  isOwner: false,
  canEditContent: false,
  canComment: false,
  canManageShares: false,
  grants: [
    { scopeType: "folder", scopeKey: "Projects", role: "editor" },
    { scopeType: "folder", scopeKey: "Reading", role: "viewer" },
    { scopeType: "item", scopeKey: "item-one", role: "editor" },
  ],
};

describe("shared file-vault navigation data", () => {
  it("accepts the scoped discovery and capability response shapes", () => {
    const workspaces = parseSharedVaults({ workspaces: [{
      id: workspaceId,
      name: "A shared workspace",
      items: [{ itemId: "item-one", relativePath: "Projects/One.textpack" }],
      folders: ["Projects"],
    }] });
    expect(workspaces[0].items[0].relativePath).toBe("Projects/One.textpack");
    expect(parseVaultAccess(scopedAccess)).toEqual(scopedAccess);
  });

  it("rejects malformed discovery and capability payloads before using them for navigation", () => {
    expect(() => parseSharedVaults({ workspaces: [{ id: "not-a-workspace-id", name: "Bad", items: [], folders: [] }] })).toThrow();
    expect(() => parseSharedVaults({ workspaces: [{ id: workspaceId, name: "Bad", items: [{ itemId: "one" }], folders: [] }] })).toThrow();
    expect(() => parseVaultAccess({ ...scopedAccess, grants: [{ scopeType: "workspace", scopeKey: "Projects", role: "editor" }] })).toThrow();
    expect(() => parseVaultAccess({ ...scopedAccess, canManageShares: "yes" })).toThrow();
  });

  it("limits creation to an editor-granted folder and its descendants", () => {
    expect(canCreateInVaultFolder(scopedAccess, "Projects")).toBe(true);
    expect(canCreateInVaultFolder(scopedAccess, "Projects/2026")).toBe(true);
    expect(canCreateInVaultFolder(scopedAccess, "Projectscape")).toBe(false);
    expect(canCreateInVaultFolder(scopedAccess, "Reading")).toBe(false);
    expect(canCreateInVaultFolder(scopedAccess, "")).toBe(false);
    expect(canCreateInVaultFolder(null, "Projects")).toBe(false);
    expect(canCreateInVaultFolder({ ...scopedAccess, fullAccess: true, canEditContent: false }, "Projects")).toBe(false);
  });

  it("recognizes viewer folders without treating item grants as folder access", () => {
    expect(canViewVaultFolder(scopedAccess, "Reading/2026")).toBe(true);
    expect(canViewVaultFolder(scopedAccess, "ReadingList")).toBe(false);
    expect(canViewVaultFolder(scopedAccess, "item-one")).toBe(false);
    expect(canViewVaultFolder({ ...scopedAccess, fullAccess: true }, "Other")).toBe(true);
  });

  it("builds stable item links without exposing a file path", () => {
    expect(sharedWorkspaceHref(workspaceId)).toBe(`/vault/${workspaceId}`);
    expect(sharedFileHref(workspaceId, "plan-1"))
      .toBe(`/vault/${workspaceId}?item=plan-1`);
    expect(sharedFolderHref(workspaceId, "Projects/Year #1"))
      .toBe(`/vault/${workspaceId}#folder=Projects%2FYear%20%231`);
    expect(() => sharedWorkspaceHref("../other")).toThrow();
    expect(() => sharedFileHref(workspaceId, "Projects/Plan.textpack")).toThrow();
    expect(() => sharedFileHref(workspaceId, "")).toThrow();
    expect(() => sharedFileHref(workspaceId, "../Private")).toThrow();
    expect(() => sharedFolderHref(workspaceId, "Projects/../Private")).toThrow();
  });

  it("follows a changed fragment only when the target remains in the authorized listing", () => {
    const files = ["Projects/One.textpack", "Projects/Two.textpack"];
    const folders = ["Projects"];
    expect(sharedVaultHashTarget("#file=Projects%2FOne.textpack", files, folders))
      .toEqual({ type: "file", path: "Projects/One.textpack" });
    expect(sharedVaultHashTarget("#file=Projects%2FTwo.textpack", files, folders))
      .toEqual({ type: "file", path: "Projects/Two.textpack" });
    expect(sharedVaultHashTarget("#folder=Projects", files, folders))
      .toEqual({ type: "folder", path: "Projects" });
    expect(sharedVaultHashTarget("#file=Private%2FSecret.textpack", files, folders)).toBeNull();
    expect(sharedVaultHashTarget("#folder=Private", files, folders)).toBeNull();
  });

  it("resolves an item link after a rename only when the current listing includes that item", () => {
    const current = [{ itemId: "plan-1", path: "Projects/Renamed.textpack" }];
    expect(sharedVaultLinkTarget("?item=plan-1", "", current, ["Projects"]))
      .toEqual({ type: "file", path: "Projects/Renamed.textpack" });
    expect(sharedVaultLinkTarget("?item=private", "", current, ["Projects"])).toBeNull();
    expect(sharedVaultLinkTarget("?item=../private", "", current, ["Projects"])).toBeNull();
    expect(sharedVaultLinkTarget("", "#file=Projects%2FRenamed.textpack", current, ["Projects"]))
      .toEqual({ type: "file", path: "Projects/Renamed.textpack" });
  });
});
