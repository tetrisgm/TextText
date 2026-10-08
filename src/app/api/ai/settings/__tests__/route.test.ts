import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock("@/app/editor/ai-config-actions", () => ({ getWorkspaceAiSettingsAction: mock.read, saveWorkspaceAiSettingsAction: mock.save, removeWorkspaceAiSettingsAction: mock.remove }));
vi.mock("@/lib/request-origin", () => ({ requestPublicOrigin: () => "https://texttext.app" }));
import { GET, POST } from "../route";
const state = { allowed: true, configured: false, provider: null, model: null, connectionState: "not-set-up", checkedAt: null };
const request = (body: unknown, origin = "https://texttext.app") => new Request("https://texttext.app/api/ai/settings?handle=owner", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mock.read.mockResolvedValue(state); mock.save.mockResolvedValue({ ...state, configured: true, provider: "openai", model: "gpt-5.6", connectionState: "ready" }); mock.remove.mockResolvedValue(state); });
describe("owner cloud AI settings route", () => {
  it("returns safe status and invokes existing authorized save without returning the key", async () => {
    expect((await GET(new Request("https://texttext.app/api/ai/settings?handle=owner"))).headers.get("cache-control")).toContain("no-store");
    const secret = "dummy-api-key-not-a-real-credential";
    const response = await POST(request({ action: "save", provider: "openai", model: "gpt-5.6", apiKey: secret }));
    expect(response.status).toBe(200); expect(await response.text()).not.toContain(secret);
    expect(mock.save).toHaveBeenCalledExactlyOnceWith("owner", "openai", "gpt-5.6", secret);
  });
  it("denies nonowners before mutations", async () => {
    mock.read.mockResolvedValue({ ...state, allowed: false });
    expect((await GET(new Request("https://texttext.app/api/ai/settings?handle=owner"))).status).toBe(403);
    expect((await POST(request({ action: "remove" }))).status).toBe(403); expect(mock.remove).not.toHaveBeenCalled();
  });
  it.each(["https://evil.test", "null", ""])("rejects origin %s before reading settings", async origin => {
    expect((await POST(request({ action: "remove" }, origin))).status).toBe(403); expect(mock.read).not.toHaveBeenCalled();
  });
  it("bounds bodies and rejects unexpected fields", async () => {
    expect((await POST(request({ action: "save", apiKey: "x".repeat(2049) }))).status).toBe(413);
    expect((await POST(request({ action: "remove", workspaceId: "other" }))).status).toBe(400); expect(mock.read).not.toHaveBeenCalled();
  });
  it("disconnects through the existing audited action", async () => {
    expect((await POST(request({ action: "remove" }))).status).toBe(200); expect(mock.remove).toHaveBeenCalledExactlyOnceWith("owner");
  });
  it("does not expose provider or credential exceptions", async () => {
    mock.save.mockRejectedValue(new Error("secret-provider-detail"));
    const response = await POST(request({ action: "save", provider: "openai", model: "gpt-5.6", apiKey: "dummy-key" }));
    expect(response.status).toBe(400); expect(await response.text()).not.toContain("secret-provider-detail");
  });
});
