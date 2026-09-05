import { describe, expect, it } from "vitest";
import { itemAgentAccess, itemAgentAllows, itemAgentScope } from "../item-agent-access";
import { appSessionHasSyncScope } from "../app-session";
import { WORKSPACE_TOOL_NAMES } from "../ai/tools";
import { agentClient, agentClientConfiguration, localAgentInstruction, remoteAgentInstruction } from "../agent-connect";
import { enforceMcpToolScope } from "../mcp/auth";
import type { AuthInfo } from "../mcp/types";
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const scope = itemAgentScope(id, "edit");
describe("item token authority", () => {
  it("round trips one item and rejects malformed or combined grants", () => {
    expect(itemAgentAccess([scope])).toEqual({ itemId: id, role: "edit" });
    for (const scopes of [[], ["item:bad:edit"], [scope, "sync"], [scope, scope], ["item:" + id + ":admin"]]) expect(itemAgentAccess(scopes)).toBeNull();
    expect(() => itemAgentScope("bad", "edit")).toThrow();
  });
  it.each(WORKSPACE_TOOL_NAMES.filter((name) => !["read_item", "update_item", "append_to_item"].includes(name)))("denies %s even with the right item id", (name) => {
    expect(itemAgentAllows([scope], name, { id })).toBe(false);
  });
  it("checks exact item on reads and writes and blocks metadata expansion", () => {
    for (const name of ["read_item", "update_item", "append_to_item"]) {
      expect(itemAgentAllows([scope], name, { id })).toBe(true);
      expect(itemAgentAllows([scope], name, { id: other })).toBe(false);
      expect(itemAgentAllows([scope], name, {})).toBe(false);
    }
    for (const field of ["markdown", "status", "slug", "fields", "folder_id", "cover", "template"]) expect(itemAgentAllows([scope], "update_item", { id, [field]: "anything" })).toBe(false);
    expect(itemAgentAllows([scope], "update_item", { id, body: "new", section: "## A", expected_section_body: "old" })).toBe(true);
  });
  it("read-only cannot edit or exchange for an owner session", () => {
    const read = itemAgentScope(id, "read");
    expect(itemAgentAllows([read], "read_item", { id })).toBe(true);
    expect(itemAgentAllows([read], "append_to_item", { id })).toBe(false);
    expect(itemAgentAllows([read], "update_item", { id })).toBe(false);
    expect(appSessionHasSyncScope(read)).toBe(false);
    expect(appSessionHasSyncScope(scope + " sync")).toBe(false);
  });
  it("enforces transport scope before resources, prompts, batch calls or tools dispatch", () => {
    const request = new Request("https://texttext.test/api/mcp") as Request & { auth: AuthInfo };
    request.auth = { token: "", clientId: "owner", scopes: [scope] };
    for (const method of ["resources/read", "prompts/get", "subscriptions/listen"]) expect(enforceMcpToolScope(request, { method })?.status).toBe(403);
    expect(enforceMcpToolScope(request, { method: "tools/call", params: { name: "read_item", arguments: { id } } })).toBeNull();
    expect(enforceMcpToolScope(request, [{ method: "ping" }, { method: "tools/call", params: { name: "read_item", arguments: { id: other } } }])?.status).toBe(403);
    expect(enforceMcpToolScope(request, { method: "tools/list" })).toBeNull();
  });
});
describe("non-secret instructions", () => {
  it("addresses an exact id and safely quotes a local label", () => {
    const prompt = localAgentInstruction(id, "Claude ' $(unsafe)");
    expect(prompt).toContain('read_item --args \'{"id":"' + id);
    expect(prompt).toContain("'\\''");
    expect(prompt).toContain("wait for my editing instructions");
    expect(remoteAgentInstruction(id)).toContain(id);
    expect(remoteAgentInstruction(id, "read")).toContain("This connection is read-only.");
    expect(remoteAgentInstruction(id, "read")).not.toContain("For edits");
  });
  it.each(["Claude Code", "Codex", "Cursor"] as const)("keeps %s configuration secret-free and isolates its environment variable", (client) => {
    const config = agentClientConfiguration(client, id);
    expect(config.text).not.toContain("wsk_");
    expect(config.text).toContain("TEXTTEXT_ITEM_11111111111141118111111111111111");
    expect(config.text).not.toContain("TEXTTEXT_WORKSPACE_TOKEN");
    expect(config.help).toContain("protected environment manager");
  });
  it("uses this deployment without carrying URL credentials, queries or fragments", () => {
    const config = agentClientConfiguration("Codex", id, "http://localhost:3000/item?secret=never#private");
    expect(config.text).toContain("http://localhost:3000/api/mcp");
    expect(config.text).not.toContain("secret");
    expect(config.text).not.toContain("private");
  });
  it("rejects invented client identities", () => { expect(() => agentClient("<script>" )).toThrow(); });
});
