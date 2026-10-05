import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as resourceMetadata } from "@/app/.well-known/oauth-protected-resource/route";
import { GET as pathResourceMetadata } from "@/app/.well-known/oauth-protected-resource/api/mcp/route";
import { GET as serverMetadata } from "@/app/.well-known/oauth-authorization-server/route";
import { authorizationErrorRedirect, OAuthRequestError } from "@/lib/oauth";

beforeEach(() => vi.stubEnv("TEXTTEXT_PRODUCT_ORIGIN", "https://texttext.example"));
afterEach(() => vi.unstubAllEnvs());

describe("MCP OAuth discovery", () => {
  it("advertises one canonical resource and issuer through both metadata paths", async () => {
    const root = await resourceMetadata(new Request("https://texttext.example/.well-known/oauth-protected-resource"));
    const path = await pathResourceMetadata(new Request("https://texttext.example/.well-known/oauth-protected-resource/api/mcp"));
    expect(root.status).toBe(200);
    expect(await root.json()).toEqual(await path.json());
    const metadata = await resourceMetadata(new Request("https://texttext.example/.well-known/oauth-protected-resource"));
    expect(await metadata.json()).toMatchObject({
      resource: "https://texttext.example/api/mcp",
      authorization_servers: ["https://texttext.example"],
      scopes_supported: ["read", "sync"],
    });
  });

  it("advertises PKCE, CIMD, and issuer-bearing responses without DCR", async () => {
    const response = await serverMetadata(new Request("https://texttext.example/.well-known/oauth-authorization-server"));
    const metadata = await response.json();
    expect(metadata).toMatchObject({
      issuer: "https://texttext.example",
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
    expect(metadata).not.toHaveProperty("registration_endpoint");
    const error = authorizationErrorRedirect("https://chatgpt.com/connector_platform_oauth_redirect",
      new OAuthRequestError("access_denied", "Denied"), "opaque-state", metadata.issuer);
    expect(new URL(error).searchParams.get("iss")).toBe(metadata.issuer);
  });
});
