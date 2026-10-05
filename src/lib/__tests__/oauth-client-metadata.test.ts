import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientId = "https://chatgpt.com/oauth/client.json";
const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
const metadata = { client_id: clientId, redirect_uris: [redirect],
  token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
  grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] };

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("pinned ChatGPT client metadata", () => {
  it("fetches only the fixed document and accepts its stable callback", async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toBe(clientId);
      return Response.json(metadata);
    });
    vi.stubGlobal("fetch", fetcher);
    const { loadOAuthClients } = await import("@/app/oauth/clients");
    expect(await loadOAuthClients()).toMatchObject([{ clientId, redirectUris: [redirect],
      defaultScope: "sync" }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(clientId);
  });

  it("fails closed when the published redirect or public-client method changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...metadata,
      redirect_uris: ["https://attacker.example/callback"] })));
    const { loadOAuthClients } = await import("@/app/oauth/clients");
    await expect(loadOAuthClients()).rejects.toThrow("does not match");
  });
});
