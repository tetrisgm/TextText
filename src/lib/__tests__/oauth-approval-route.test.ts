import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  user: vi.fn(), userId: vi.fn(), workspace: vi.fn(), clients: vi.fn(), issueCode: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: mock.user }));
vi.mock("@/lib/store", () => ({ getUserIdBySub: mock.userId }));
vi.mock("@/lib/workspace", () => ({ resolveOwnedWorkspace: mock.workspace }));
vi.mock("@/app/oauth/clients", () => ({ loadOAuthClients: mock.clients }));
vi.mock("@/lib/oauth", async (original) => ({
  ...(await original<typeof import("@/lib/oauth")>()),
  issueOAuthAuthorizationCode: mock.issueCode,
}));

import { POST } from "@/app/oauth/authorize/approve/route";
import { pkceS256Challenge } from "@/lib/oauth";

const origin = "https://texttext.example";
const resource = `${origin}/api/mcp`;
const clientId = "https://chatgpt.com/oauth/client.json";
const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";

function approve(resourceValue = resource, originValue = origin) {
  return POST(new Request(`${origin}/oauth/authorize/approve`, {
    method: "POST",
    headers: { Origin: originValue, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ decision: "approve", response_type: "code",
      client_id: clientId, redirect_uri: redirectUri, scope: "sync", resource: resourceValue,
      code_challenge: pkceS256Challenge("v".repeat(43)), code_challenge_method: "S256",
      state: "opaque-state" }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TEXTTEXT_PRODUCT_ORIGIN", origin);
  mock.user.mockResolvedValue({ sub: "apple-sub" });
  mock.userId.mockResolvedValue("00000000-0000-4000-8000-000000000001");
  mock.workspace.mockResolvedValue({});
  mock.clients.mockResolvedValue([{ clientId, name: "ChatGPT", redirectUris: [redirectUri],
    defaultScope: "sync" }]);
  mock.issueCode.mockResolvedValue({ code: "woc_test", expiresAt: new Date() });
});
afterEach(() => vi.unstubAllEnvs());

describe("ChatGPT authorization approval", () => {
  it("returns code, state, and exact issuer after signed-in consent", async () => {
    const response = await approve();
    expect(response.status).toBe(303);
    const target = new URL(response.headers.get("location")!);
    expect(target.origin + target.pathname).toBe(redirectUri);
    expect(target.searchParams.get("code")).toBe("woc_test");
    expect(target.searchParams.get("state")).toBe("opaque-state");
    expect(target.searchParams.get("iss")).toBe(origin);
    expect(mock.issueCode).toHaveBeenCalledWith(expect.objectContaining({ resource,
      clientId, redirectUri, scope: "sync" }));
  });

  it("rejects a different resource with an issuer-bearing error", async () => {
    const response = await approve("https://attacker.example/api/mcp");
    expect(response.status).toBe(303);
    const target = new URL(response.headers.get("location")!);
    expect(target.searchParams.get("error")).toBe("invalid_target");
    expect(target.searchParams.get("iss")).toBe(origin);
    expect(mock.issueCode).not.toHaveBeenCalled();
  });

  it("rejects cross-origin consent posts", async () => {
    const response = await approve(resource, "https://attacker.example");
    expect(response.status).toBe(400);
    expect(mock.issueCode).not.toHaveBeenCalled();
  });
});
