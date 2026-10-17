import { describe, expect, it } from "vitest";
import { workspaceShareLink } from "./workspace-share-link";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const target = { workspaceId, scopeType: "item" as const, scopeKey: "item-1" };
const base = `https://texttext.app/vault/${workspaceId}`;
describe("private workspace share links", () => {
  it("uses the native connection's verified workspace URL without retaining current item or fragment", () => {
    expect(workspaceShareLink(target, `${base}?item=old#folder=old`)).toBe(`${base}?item=item-1`);
    expect(workspaceShareLink({ ...target, scopeType: "folder", scopeKey: "Research/Field notes" }, base))
      .toBe(`${base}#folder=Research%2FField%20notes`);
  });
  it("retains the workspace's server, port and private route on every client", () => {
    expect(workspaceShareLink(target, `https://staging.example:8443/vault/${workspaceId}/`))
      .toBe(`https://staging.example:8443/vault/${workspaceId}?item=item-1`);
    expect(workspaceShareLink(target, `http://localhost:3000/vault/${workspaceId}`))
      .toBe(`http://localhost:3000/vault/${workspaceId}?item=item-1`);
  });
  it.each([null, undefined, "null", "file:///Applications/TextText.app/index.html", "texttext://vault", `https://texttext.local/vault/${workspaceId}`, `http://remote.example/vault/${workspaceId}`, `https://user:password@texttext.app/vault/${workspaceId}`, "https://texttext.app/vault/22222222-2222-4222-8222-222222222222", "https://texttext.app/u/public", "https://texttext.app/"])("rejects unavailable, synthetic, unsafe or mismatched workspace address %s", url => {
    expect(workspaceShareLink(target, url)).toBeNull();
  });
  it("rejects invalid scope identity and folder paths", () => {
    expect(workspaceShareLink({ ...target, workspaceId:"../other" }, base)).toBeNull();
    expect(workspaceShareLink({ ...target, scopeKey:"other?admin=true" }, base)).toBeNull();
    expect(workspaceShareLink({ ...target, scopeType:"folder", scopeKey:"../private" }, base)).toBeNull();
  });
});
