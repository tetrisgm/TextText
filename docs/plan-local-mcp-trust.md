# Execution plan: local MCP trust

The buildable plan for `docs/decision-local-mcp-trust.md`. Written 2026-07-28
after a de-risking spike. Read the decision doc first for why; this is what and
in what order.

Baseline: `main` at `9afd1e7`, Texttext 0.142 build 148 shipped and installed.

Three units, in order. Unit A ships alone and closes a live hole. Unit B is
independent of the auth decision. Unit C is the product feature and depends on
both.

---

## What the spike settled (so nobody re-litigates it)

**Codex does OAuth against a plain-http loopback MCP resource. Proven
empirically, not inferred.** A throwaway server on `127.0.0.1:47219` returning
401 plus RFC 9728 metadata caused Codex to emit:

```
http://127.0.0.1:47219/authorize?response_type=code&client_id=loopback-test-client
  &state=...&code_challenge=...&code_challenge_method=S256
  &redirect_uri=http%3A%2F%2F127.0.0.1%3A53040%2Fcallback%2FGf-V7iSnrHTv
  &scope=workspace.read+workspace.write
  &resource=http%3A%2F%2F127.0.0.1%3A47219%2Fmcp
```

That single URL proves Codex accepts a non-TLS loopback resource, performs
RFC 9728 discovery, uses PKCE S256, sends the RFC 8707 `resource` indicator, and
opens the browser unprompted.

**Claude Code supports the same flow, per its official documentation:**
"A custom server that returns a `WWW-Authenticate` header pointing to its
authorization server gets the same automatic discovery as any other remote
server." It marks a server as needing auth on 401 or 403, supports both Dynamic
Client Registration and Client ID Metadata Documents, uses loopback callbacks on
ephemeral ports, and offers `claude mcp login <name>` from the shell plus
`--callback-port` to pin the port.

**Two caveats to design around, both from the Claude Code docs:**

1. **Non-interactive mode cannot run the OAuth flow.** In `claude -p` or Agent
   SDK runs there is no `/mcp` panel, so a headless agent hits an unauthorized
   server and is told the tools are unavailable. Mitigation: the token persists
   after one interactive `claude mcp login texttext`, so this is a one-time
   setup step, but it must be documented or headless users will think it is
   broken.
2. **A rejected static `Authorization` header does NOT fall back to OAuth.**
   Claude Code reports the connection failed instead. So never document both a
   header and OAuth for the same server.

**Residual unknown, low risk:** Claude Code accepting a non-TLS `http://`
*resource* URL specifically is documented-compatible but not empirically
confirmed. Verify with one `claude mcp login texttext` against the real endpoint
at the start of Unit C. It costs nothing and needs no Codex credit.

---

## Unit A: Tier 0 hardening

Closes the live blind-write CSRF path. No UX change. Ships independently of
every other decision here.

**Structural prerequisite, do this first.** Items A1 to A4 and A7 are all "may
this caller reach the workspace at all", and that decision is currently welded
into an `async @MainActor` method (`LocalAgentServer.swift:200`), so neither the
health reporter nor a fast unit test can exercise it. Add two things:

- **`LocalAgentServer.rejection(for:) -> LocalAgentHTTPResponse?`**, a
  `nonisolated static` pure function (nil means admissible). `respond` calls it
  first; `AppHealthReporter` calls it directly; every guard test calls it with
  no `await`.
- **`LocalAgentChannel`**, a settle-once per-connection object owning the
  deadline timer, the single send, and the slot release. Without it A5 is
  untestable and a deadline can frame two responses onto one socket.

Then:

| # | Change | Where |
|---|---|---|
| A1 | Reject any request carrying `Origin`, or a cross-site `Sec-Fetch-Site`, with 403 | new `rejection(for:)` |
| A2 | Require `Content-Type: application/json` strictly on `POST /mcp` | `rejection(for:)`; body parse at `:214-218` currently ignores it |
| A3 | Explicit `OPTIONS` returning 405 with no CORS headers, and an `Allow` header | router `:206-213`; needs a `headers` field on `LocalAgentHTTPResponse` (`:47-78`), defaulted so both existing call sites still compile |
| A4 | Remove `parameters.allowLocalEndpointReuse = true` | `:122`, but see the warning below |
| A5 | Per-request deadline and concurrent-connection cap | receive loop `:154-198` |
| A6 | Correct the health check and tests that assert "loopback only" as the security property | `AppHealthReporter.swift:721-739`, `LocalAgentServerTests.swift:44-45` |
| A7 | Numeric-loopback-only `Host` allowlist | `isLoopbackHost` `:39-44` |

**A2 is the single highest-value line, not A1.** It is what makes a browser
unable to *construct* a reaching request, because `application/json` forces a
preflight that has no answer. A1 is the spec's MUST and belongs in anyway.

**A4 is not a safe one-liner in this repo.** `release/ship.sh:342-395` quits and
relaunches the app within seconds, and macOS TIME_WAIT here is 30 s
(`net.inet.tcp.msl` = 15000 ms). Removing endpoint reuse can make the relaunched
app fail to bind, and `start()` currently only `NSLog`s that failure
(`:141`), so it would fail silently. Either keep reuse and accept the squatting
risk, or remove it and add a bind-retry with a user-visible failure. Decide
explicitly; do not let it be an accident.

**A7 is nearly free and nearly pointless, do it anyway.** Nothing in the product
ever emits `localhost:47118`: `src/lib/agent-integrations.ts:2` is the single
source and it is numeric, consumed by `ConnectPanel.tsx:62,64` and
`docs/ai/page.tsx:244`. The only breakage surface is a hand-typed config, and the
failure is loud. But note honestly: once A1 lands, dropping `localhost` buys
close to nothing, because script cannot set `Host` and the listener is
IPv4-loopback-bound. Do not present A7 as the rebinding control. A1 and A2 are
the controls. Make the 403 self-diagnosing.

**Compatibility:** both documented clients already send
`content-type: application/json` (Codex via reqwest, Claude Code via the MCP TS
SDK), and neither sends `Origin`. The `HANDOFF.md:121` acceptance test sets the
content type explicitly. Nothing in `scripts/` or `release/` probes port 47118.

**Tests:** guard tests against `rejection(for:)` directly (Origin present,
cross-site `Sec-Fetch-Site`, wrong content type, `OPTIONS`, non-numeric Host,
and the admissible case), plus deadline and connection-cap tests against
`LocalAgentChannel`.

---

## Unit B: attribution and confirmation

Integrity defects that hold regardless of the auth decision, and Unit C's value
proposition depends on B1.

- **B1. The audit trail cannot see this transport.** `runWorkspaceToolForSession`
  hardcodes `clientId: "in-app-assistant"`, `actorType: "ai"`, and full-access
  scope (`src/lib/mcp/tools.ts:1992-2010`), so a local agent's mutation and the
  owner's own sidebar request write identical `action_audit` rows. This
  contradicts `docs/ai-sidebar-architecture.md:22-24`. The bridge must carry a
  connection descriptor (`{tokenId, clientName, scopes}`) and
  `/api/ai/tools` must pass it through.
- **B2. The confirmation dialog is not a security boundary.** It never names the
  caller (`PostWorkspaceShell.tsx:6527-6534`), and it holds a single pending
  resolver that is settled false when a new request arrives
  (`confirmation.ts:32`), which is a dialog-swap race an attacker can retry
  against an unrated port. Name the caller and queue rather than replace.
- **B3.** Consider making it native, since the app runs windowless from the menu
  bar and an in-page dialog is invisible then.

---

## Unit C: Tier 1 authorization

Extend the existing OAuth flow to the loopback endpoint. **The documented
connect command does not change.**

### C0. Two blockers that must land first, or Tier 1 ships a hole

1. **The token endpoint rejects the loopback audience today.**
   `validateRequestedResource` throws `invalid_target` for any `resource` other
   than `${getPublicOrigin(request)}/api/mcp`
   (`src/app/oauth/token/route.ts:149-163`, enforced at `:201` and `:229`). A
   real client sends `resource=http://127.0.0.1:47118/mcp` and is refused.
   Widen to an allowlist of exactly two values.

2. **There is no audience column, so widening (1) naively creates audience
   confusion.** `api_tokens` has `scopes` but no audience
   (`src/lib/db/schema.ts:254-264`). Without one, a token minted for the
   loopback is a fully valid credential against `https://texttext.app/api/mcp`
   **from anywhere on the internet**. That is the single biggest new risk Tier 1
   introduces, because it moves a workspace credential into a local agent's
   config file. Add a nullable `audience` column, set it from the validated
   `resource` at mint (`src/lib/oauth.ts:243-250` and the insert at `:375-395`),
   return it from `resolveApiToken`, and have `verifyWriteApiToken`
   (`src/lib/mcp/auth.ts:22-46`) reject loopback-audience tokens while
   introspection rejects hosted-audience ones.

Good news the spike confirmed: loopback `http://` redirect URIs already validate
(`src/lib/oauth.ts:596-601`) and dynamic client registration runs them through
the same check (`src/app/oauth/register/route.ts:280-289`), so a local client can
self-register and complete the flow today.

### C1. Validation path: the app introspects, it does not ask the page

Three options were evaluated. **Choose (b).**

- **(a) Forward the header through the page bridge: rejected.** It is a genuine
  confused deputy, because the page is simultaneously the protected resource and
  the oracle that says whether the token is good, so the check adds no linkage
  between "holds a credential" and "may use this session". It creates a
  session-authenticated token-testing oracle in the app origin. It breaks when
  the window is closed, which is the app's normal state, since `webView` is weak
  (`LocalAgentServer.swift:112`) and `evaluate` throws when nil (`:402-405`). It
  puts the raw bearer in the page's JS heap. It makes `tools/list`, currently
  served offline from an in-memory manifest, require a network round trip. And
  decisively, it cannot answer the question Tier 1 exists to answer: identity
  still arrives from the same untrusted process that supplied `clientInfo`.
- **(b) The app introspects against texttext.app: chosen.** Two distinct
  principals, no deputy. Works windowless. No secret in page JavaScript. Yields
  verified client identity for free. Same validator serves the fallback path.
- **(c) A local-only secret: emergency fallback only.** No server-issued
  identity, no central revocation, no scope, no attribution, and the secret
  lands in shell history. It is the only fully offline option, which is why it
  stays on the list at all.

New route, modeled on `src/app/api/app/health/route.ts:18-38`:

```
POST {serverOrigin}/api/app/introspect
Authorization: Bearer <device token>          # the app authenticates as itself
{ "token_sha256": "<hex>", "resource": "http://127.0.0.1:47118/mcp" }
->
{ "active": true, "scope": "read", "client_name": "Claude Code",
  "client_id": "...", "token_id": "...", "exp": 1730000000 }
```

Rules: resolve the device token via `resolveApiToken`; resolve the presented
token **by hash** (factor `resolveApiTokenByHash` out of
`src/lib/api-tokens.ts:122-128` so the raw secret never leaves the Mac);
**same-user check** between the two, which is what stops this being a general
oracle; audience check; `Cache-Control: no-store`; reuse the OAuth rate limiter.
Return an undifferentiated `{"active": false}` for unknown, revoked, expired,
wrong-audience, and other-user.

Caching, and this matters: **key by `sha256(token)`, never per connection**,
because every request is its own TCP connection (`:59`, `:184`), so per-connection
is per-request and is no cache at all. Positive TTL 60 s (bounds revocation lag
at 1.7% of the 3600 s token life), negative TTL ~5 s, never cache past `exp`,
clear on sign-out, and allow a ~15 minute stale-if-error window for a token that
validated recently so a Wi-Fi blip does not kill a working session.

### C2. Discovery on the loopback origin

The Swift router today handles only `GET /health` and `POST /mcp` (`:200-213`).
Add two GET paths returning the same document, mirroring how the web app already
serves both forms:

```
GET /.well-known/oauth-protected-resource/mcp
GET /.well-known/oauth-protected-resource
{ "resource": "http://127.0.0.1:47118/mcp",
  "authorization_servers": ["https://texttext.app"],
  "scopes_supported": ["read", "sync"],
  "bearer_methods_supported": ["header"],
  "resource_name": "Texttext on this Mac" }
```

`authorization_servers` comes from `resolveServerOrigin(credentials:)`
(`mac/Sources/Write/Constants.swift:24-41`), not a hardcoded string, so dev
builds pointing at `http://localhost:3000` work. Plus the 401 with
`WWW-Authenticate` that starts the chain.

### C3. Identity and scope

Replace the `clientInfo`-derived label (`LocalAgentServer.swift:337-352`) with
the introspected `client_name`, which comes from `api_tokens.name` written as
`"OAuth: <client>"` at mint (`src/lib/oauth.ts:243-250`) and stripped the way
`src/lib/mcp/auth.ts:29-32` already does. This is what makes the 0.142
collaborator avatar verified rather than self-declared.

State plainly in the docs: **local-path scope is enforced by the Mac app, not by
the resource server.** That is sound against every attacker class the decision
doc scopes in, and unsound only against a same-user non-sandboxed process, which
it already declares out of scope. Do not imply `read` is server-enforced the way
`enforceMcpToolScope` enforces it on the hosted path.

### C4. Surfaces to update

`src/lib/agent-integrations.ts:2` (unchanged value, but the docs around it),
`ConnectPanel.tsx:61-65`, `src/app/docs/ai/page.tsx:239-246`, `CLAUDE.md:79`,
`docs/ai-sidebar-architecture.md:111-115` and `:148-150` (the line that says
Claude Code and Codex can use it "without a Texttext token" is the doctrine this
rewrites), `docs/codex/HANDOFF.md:65-66` and `:121`.

---

## Ordering, and what each unit is worth

1. **Unit A** alone. Closes the live hole, no UX change, independently
   shippable. Verify the acceptance test in `HANDOFF.md` still passes.
2. **Unit B** next, or in parallel. Small, independent, and C's value depends on
   B1.
3. **Unit C0** (audience column and allowlist) before any of C1 to C4, because
   shipping C without an audience column would put an internet-valid workspace
   credential into a local config file.
4. **Unit C1 to C4**, opening with the one-command Claude Code check.

Do not spend effort on port randomization or on peer code-signature verification
as an authorization mechanism; see the decision doc for why both are traps.

## Verification

Per unit: `npx tsc --noEmit`, focused vitest, `swift test --filter
LocalAgentServerTests`. Extend `scripts/verify-agent-interoperability.ts`
(already a release gate, and already asserting the identity chain) with the new
guard properties, so a future build that drops the Origin check or the strict
content type fails the gate instead of silently regressing. Gate on the
committed source per `AGENTS.md`, then ship.
