import { describe, expect, it } from "vitest";
import { publicationLink } from "./publication-link";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const expected = `/v/${workspaceId}/item-1`;
const state = { itemId: "item-1", publicPath: expected };
const workspace = `https://staging.example:8443/vault/${workspaceId}`;
describe("public links across hosts", () => {
  it("retains the verified workspace origin and public route", () => {
    expect(publicationLink(state, workspaceId, workspace)).toBe(`https://staging.example:8443${expected}`);
    expect(publicationLink(state, workspaceId, `http://localhost:3000/vault/${workspaceId}`)).toBe(`http://localhost:3000${expected}`);
    expect(publicationLink({ ...state, publicURL: `https://texttext.app${expected}` }, workspaceId)).toBe(`https://texttext.app${expected}`);
  });
  it.each([null, "file:///app/index.html", `https://texttext.local/vault/${workspaceId}`, "https://texttext.app/vault/other", "https://texttext.app/"])("rejects unavailable or mismatched workspace %s", address => {
    expect(publicationLink(state, workspaceId, address)).toBe("");
  });
  it.each(["", `https://texttext.local${expected}`, `https://user:password@texttext.app${expected}`, `http://remote.example${expected}`, `https://texttext.app${expected}?token=bad`, `https://texttext.app${expected}#fragment`, "https://texttext.app/v/other/item-1", "file:///app/index.html"])("rejects malformed explicit public URL without falling back %s", publicURL => {
    expect(publicationLink({ ...state, publicURL }, workspaceId, workspace)).toBe("");
  });
  it("requires exact public path and valid identity", () => {
    expect(publicationLink({ ...state, publicPath: "/vault/other" }, workspaceId, workspace)).toBe("");
    expect(publicationLink({ itemId: "../other", publicPath: `/v/${workspaceId}/..%2Fother` }, workspaceId, workspace)).toBe("");
  });
});
