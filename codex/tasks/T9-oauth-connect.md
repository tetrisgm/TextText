# T9: OAuth 2.1 + PKCE in front of token minting

Let connector directories (ChatGPT connectors, hosted MCP hosts) obtain a
`wsk_` API token through a standard OAuth 2.1 authorization-code + PKCE flow,
instead of the user hand-copying a token from /connect. SECURITY-SENSITIVE:
the maintainer will review this hard before merge. Build it correct and
conservative; when unsure, be stricter.

## Context (read first)

- Sign-in is NextAuth (src/auth.ts); the human session is a JWT, sub scheme in
  src/lib/auth-email.ts. `getCurrentUser()` (src/lib/session.ts) gives {sub}.
- API tokens: `src/lib/api-tokens.ts` (createApiToken(userId, name) ->
  {raw, record}; hashed at rest; scopes default "sync"). Minting UI at
  `src/app/connect/**`.
- The MCP/auth layer already emits WWW-Authenticate metadata (src/lib/mcp/).

## File ownership (STRICT)

- CREATE under `src/app/oauth/**` and `src/lib/oauth.ts` (+ a schema fragment
  you re-export, and a new drizzle table for authorization codes / clients if
  needed: add it in `src/lib/db/schema.ts` ONLY by appending a new pgTable and
  its type, touch nothing existing there). You MAY add
  `src/app/.well-known/oauth-authorization-server/route.ts` metadata.
- You MAY add a small "Authorize" consent page under src/app/oauth/authorize.
- NEVER edit: src/auth.ts, api-tokens.ts internals (call createApiToken,
  do not change it), the sync/mcp routes, editor, components.
- Commit nothing. Verify: `npx tsc --noEmit`, build, and WRITE A VITEST suite
  for the PKCE verifier + code single-use + redirect_uri validation.

## What to build (OAuth 2.1, authorization code + PKCE only)

1. Discovery: `/.well-known/oauth-authorization-server` metadata (issuer,
   authorization_endpoint, token_endpoint, code_challenge_methods_supported:
   ["S256"], grant_types, response_types ["code"], token_endpoint_auth_methods
   ["none"] for public clients).
2. `GET /oauth/authorize`: requires a signed-in session (else bounce to
   /signin?callbackUrl=the-authorize-url). Validates client_id, redirect_uri
   (EXACT match against a registered/allowlisted set, https only, no open
   redirect), response_type=code, code_challenge + code_challenge_method=S256
   (REJECT plain). Renders a consent page naming the client and the scope
   (sync). On approve, issues a single-use authorization code (short TTL,
   e.g. 60s) bound to {userId, client_id, redirect_uri, code_challenge, scope}
   and redirects to redirect_uri?code=...&state=...
3. `POST /oauth/token`: grant_type=authorization_code, verifies the code is
   unexpired, unused (consume atomically), redirect_uri matches, and the
   code_verifier hashes (S256) to the stored code_challenge. On success mints
   a wsk_ token via createApiToken(userId, "OAuth: <client>") and returns
   {access_token, token_type:"Bearer", scope}. No refresh tokens in v1.
4. Store codes hashed, never raw. Reject everything that does not match the
   spec with the correct OAuth error JSON (invalid_request, invalid_grant,
   ...). Rate-reason the token endpoint (best effort).

## Hard security rules

- redirect_uri: exact string match against an allowlist, https only (localhost
  http allowed for dev clients only if you gate it behind an env flag).
- PKCE S256 mandatory; refuse "plain" and missing challenge.
- Authorization codes: single-use (atomic consume), <=60s TTL, hashed at rest.
- No implicit grant, no password grant, no wildcard redirect.
- The consent page must require an explicit click; never auto-approve.

## Verify

tsc + build + your vitest suite green. In your summary: the exact tables added,
the redirect_uri allowlist mechanism, and every place a check could be bypassed
that you closed.
