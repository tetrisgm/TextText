import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeOAuthAuthorizationCode: vi.fn(),
  loadOAuthClients: vi.fn(),
  refreshOAuthAccessToken: vi.fn(),
}));

vi.mock("@/lib/oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/oauth")>()),
  exchangeOAuthAuthorizationCode: mocks.exchangeOAuthAuthorizationCode,
  refreshOAuthAccessToken: mocks.refreshOAuthAccessToken,
}));

vi.mock("@/app/oauth/clients", () => ({
  loadOAuthClients: mocks.loadOAuthClients,
}));

import { POST } from "@/app/oauth/token/route";
import { OAuthRequestError } from "@/lib/oauth";

const clients = [
  {
    clientId: "connector",
    name: "Connector",
    redirectUris: ["https://client.example/callback"],
  },
];

function tokenRequest(fields: Record<string, string>, headers: HeadersInit = {}) {
  return new Request("https://write.example/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(fields),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadOAuthClients.mockResolvedValue(clients);
  mocks.exchangeOAuthAuthorizationCode.mockResolvedValue({
    access_token: `wsk_${"a".repeat(43)}`,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: `wrt_${"b".repeat(43)}`,
    scope: "sync",
  });
  mocks.refreshOAuthAccessToken.mockResolvedValue({
    access_token: `wsk_${"c".repeat(43)}`,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: `wrt_${"d".repeat(43)}`,
    scope: "sync",
  });
});

describe("OAuth token route", () => {
  it("dispatches authorization_code with PKCE inputs", async () => {
    const response = await POST(
      tokenRequest({
        grant_type: "authorization_code",
        code: `woc_${"e".repeat(43)}`,
        redirect_uri: clients[0].redirectUris[0],
        client_id: clients[0].clientId,
        code_verifier: "v".repeat(43),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.exchangeOAuthAuthorizationCode).toHaveBeenCalledWith(
      {
        code: `woc_${"e".repeat(43)}`,
        redirectUri: clients[0].redirectUris[0],
        clientId: clients[0].clientId,
        codeVerifier: "v".repeat(43),
      },
      expect.objectContaining({ clients }),
    );
    expect(mocks.refreshOAuthAccessToken).not.toHaveBeenCalled();
  });

  it("dispatches refresh_token with optional unchanged scope", async () => {
    const response = await POST(
      tokenRequest({
        grant_type: "refresh_token",
        refresh_token: `wrt_${"f".repeat(43)}`,
        client_id: clients[0].clientId,
        scope: "sync",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      expires_in: 3600,
      scope: "sync",
    });
    expect(mocks.refreshOAuthAccessToken).toHaveBeenCalledWith(
      {
        refreshToken: `wrt_${"f".repeat(43)}`,
        clientId: clients[0].clientId,
        scope: "sync",
      },
      { clients },
    );
    expect(mocks.exchangeOAuthAuthorizationCode).not.toHaveBeenCalled();
  });

  it("rejects cross-grant parameters and public-client authentication", async () => {
    const crossGrant = await POST(
      tokenRequest({
        grant_type: "refresh_token",
        refresh_token: `wrt_${"f".repeat(43)}`,
        client_id: clients[0].clientId,
        code: "unexpected",
      }),
    );
    expect(crossGrant.status).toBe(400);
    await expect(crossGrant.json()).resolves.toMatchObject({
      error: "invalid_request",
    });

    const authenticated = await POST(
      tokenRequest(
        {
          grant_type: "refresh_token",
          refresh_token: `wrt_${"f".repeat(43)}`,
          client_id: clients[0].clientId,
        },
        { Authorization: "Basic secret" },
      ),
    );
    expect(authenticated.status).toBe(400);
    await expect(authenticated.json()).resolves.toMatchObject({
      error: "invalid_client",
    });
    expect(mocks.refreshOAuthAccessToken).not.toHaveBeenCalled();
  });

  it("returns a generic invalid_grant without leaking storage failures", async () => {
    mocks.refreshOAuthAccessToken.mockRejectedValue(
      new OAuthRequestError(
        "invalid_grant",
        "refresh token is expired, revoked, used, or invalid",
      ),
    );
    const response = await POST(
      tokenRequest({
        grant_type: "refresh_token",
        refresh_token: `wrt_${"f".repeat(43)}`,
        client_id: clients[0].clientId,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_grant",
      error_description: "refresh token is expired, revoked, used, or invalid",
    });
  });
});
