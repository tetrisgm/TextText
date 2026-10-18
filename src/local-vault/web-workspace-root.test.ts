import { expect, it } from "vitest";
import { workspaceIdFromWebRoot } from "./web-workspace-root";

it("separates the route workspace from an account-scoped durable root", () => {
  expect(workspaceIdFromWebRoot('vault:["account-a","workspace-a"]')).toBe("workspace-a");
  expect(workspaceIdFromWebRoot('vault:["account-b","workspace-a"]')).toBe("workspace-a");
  expect(workspaceIdFromWebRoot("vault:legacy-workspace")).toBe("legacy-workspace");
});
it("refuses malformed encoded scopes instead of using them as route identities", () => {
  for (const root of [null, undefined, "/local/path", "vault:", 'vault:["one"]', 'vault:["a","b","c"]', 'vault:[null,"b"]', 'vault:{"workspaceId":"b"}', 'vault:["a","../b"]', 'vault:["a","b"]trailing']) {
    expect(workspaceIdFromWebRoot(root)).toBeNull();
  }
});
