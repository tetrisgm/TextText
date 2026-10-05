import type { OAuthClient } from "@/lib/oauth";

// ChatGPT identifies itself with this fixed HTTPS metadata document. Fetching
// only this pinned URL avoids dynamic client registration and SSRF.
const CHATGPT_CLIENT_ID = "https://chatgpt.com/oauth/client.json";
const CHATGPT_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
let cached: { client: OAuthClient; until: number } | null = null;

export async function loadOAuthClients(): Promise<OAuthClient[]> {
  if (cached && cached.until > Date.now()) return [cached.client];
  const response = await fetch(CHATGPT_CLIENT_ID, {
    cache: "no-store",
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error("ChatGPT client metadata is unavailable");
  const metadata: unknown = await response.json();
  if (!metadata || typeof metadata !== "object") throw new Error("Invalid ChatGPT client metadata");
  const client = metadata as Record<string, unknown>;
  if (
    client.client_id !== CHATGPT_CLIENT_ID ||
    !Array.isArray(client.redirect_uris) ||
    !client.redirect_uris.includes(CHATGPT_REDIRECT) ||
    !Array.isArray(client.token_endpoint_auth_methods_supported) ||
    !client.token_endpoint_auth_methods_supported.includes("none") ||
    !Array.isArray(client.grant_types) ||
    !client.grant_types.includes("authorization_code") ||
    !Array.isArray(client.response_types) ||
    !client.response_types.includes("code")
  ) {
    throw new Error("ChatGPT client metadata does not match the supported flow");
  }
  const verified: OAuthClient = {
    clientId: CHATGPT_CLIENT_ID,
    name: "ChatGPT",
    redirectUris: [CHATGPT_REDIRECT],
    defaultScope: "sync",
  };
  cached = { client: verified, until: Date.now() + 10 * 60_000 };
  return [verified];
}
