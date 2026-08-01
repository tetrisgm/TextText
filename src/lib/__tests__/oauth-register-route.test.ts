import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRegisteredOAuthClient: vi.fn(),
}));

vi.mock("@/app/oauth/clients", () => ({
  OAuthClientRegistrationError: class OAuthClientRegistrationError extends Error {
    readonly status: number;

    constructor(message: string, status = 503) {
      super(message);
      this.status = status;
    }
  },
  createRegisteredOAuthClient: mocks.createRegisteredOAuthClient,
}));

import { POST } from "@/app/oauth/register/route";

function registrationRequest(metadata: Record<string, unknown>): Request {
  return new Request("https://texttext.example/oauth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "192.0.2.10",
    },
    body: JSON.stringify(metadata),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createRegisteredOAuthClient.mockImplementation(async (input) => ({
    clientId: "wcl_test",
    clientName: input.clientName,
    redirectUris: input.redirectUris,
    scope: input.scope ?? "sync",
    createdAt: new Date("2026-07-15T12:00:00.000Z"),
  }));
});

describe("OAuth dynamic client registration", () => {
  it("registers a read-only client that can use refresh_token", async () => {
    const response = await POST(
      registrationRequest({
        client_name: "Read connector",
        redirect_uris: ["https://connector.example/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: "read",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      client_id: "wcl_test",
      grant_types: ["authorization_code", "refresh_token"],
      scope: "read",
    });
    expect(mocks.createRegisteredOAuthClient).toHaveBeenCalledWith({
      clientName: "Read connector",
      redirectUris: ["https://connector.example/callback"],
      scope: "read",
    });
  });

  it("preserves sync and authorization_code defaults for existing clients", async () => {
    const response = await POST(
      registrationRequest({
        client_name: "Existing connector",
        redirect_uris: ["https://connector.example/callback"],
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      grant_types: ["authorization_code"],
      scope: "sync",
    });
    expect(mocks.createRegisteredOAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "sync" }),
    );
  });

  it("registers a native client with an exact loopback callback", async () => {
    const response = await POST(
      registrationRequest({
        client_name: "Codex",
        redirect_uris: ["http://127.0.0.1:3456/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: "sync",
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createRegisteredOAuthClient).toHaveBeenCalledWith({
      clientName: "Codex",
      redirectUris: ["http://127.0.0.1:3456/callback"],
      scope: "sync",
    });
  });

  it("rejects insecure callbacks outside the loopback interface", async () => {
    const response = await POST(
      registrationRequest({
        redirect_uris: ["http://connector.example/callback"],
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_redirect_uri",
    });
    expect(mocks.createRegisteredOAuthClient).not.toHaveBeenCalled();
  });

  it("normalizes a request for all advertised scopes", async () => {
    const response = await POST(
      registrationRequest({
        redirect_uris: ["https://connector.example/callback"],
        scope: "read sync",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      scope: "sync",
    });
    expect(mocks.createRegisteredOAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "sync" }),
    );
  });

  it("rejects unsupported scopes", async () => {
    const response = await POST(
      registrationRequest({
        redirect_uris: ["https://connector.example/callback"],
        scope: "read unknown",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_client_metadata",
    });
    expect(mocks.createRegisteredOAuthClient).not.toHaveBeenCalled();
  });
});
