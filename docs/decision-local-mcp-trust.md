# Decision: local MCP trust model

**DECIDED 2026-07-29: Tier 0 only. Tier 1 is deferred, not rejected.** Tier 0
shipped; see the record at the end of this document. Researched 2026-07-28 by a
seven-agent sweep over the MCP specification, the top MCP-capable desktop apps,
a decade of non-MCP loopback prior art, the 2024 to 2026 CVEs in this exact
surface, and a code-level threat model of our own server.

The reasoning behind the split, in one paragraph, because it is easy to
misremember: **Tier 0 is the security fix and Tier 1 is a product feature.**
Tier 0 stops a malicious web page, which was a live and demonstrated hole. Tier 1
adds authorization on top of Tier 0, which additionally stops other user accounts
and sandboxed apps, but does **not** stop a program running as you, since that
program can read the token too. On a single-user Mac the marginal security gain
is therefore small. Tier 1's real value is three product properties: a truthful
agent badge, a revoke button, and a read-only mode. Revisit it when one of those
three actually matters, not on security grounds alone.

The subject is `LocalAgentServer` (`mac/Sources/Write/LocalAgentServer.swift`),
the loopback MCP endpoint at `http://127.0.0.1:47118/mcp` that lets a local
Codex or Claude session drive the signed-in workspace.

---

## 1. The correction that motivated this document

An earlier reading of this surface concluded that a malicious web page was
mostly blocked by accident: a JSON POST triggers a CORS preflight, our server
has no `OPTIONS` handler, so the preflight fails and the real request is never
sent.

**That conclusion was wrong, and the hole is live.**

`LocalAgentServer` never inspects `Content-Type`. The body goes straight to
`JSONSerialization` (`LocalAgentServer.swift:214-218`). A cross-origin POST with
`Content-Type: text/plain` is a CORS *simple request*, so **no preflight is
issued**, the browser sends it, `Host: 127.0.0.1:47118` passes the loopback
check at `:201-205`, the JSON parses, and **the tool call executes**.

The page cannot read the response (we emit no `Access-Control-Allow-Origin`), so
this is a blind write, not a read. Blind is not harmless:

- `create_item` needs no id, so a page can write unlimited attacker-controlled
  documents into the workspace.
- **The real payload is stored prompt injection.** A page plants documents whose
  bodies contain instructions. The owner's own agent later reads them through
  `search` or `read_item` and executes them with the full 30-tool workspace
  authority plus, for Claude Code and Codex, local file and shell authority. A
  blind write from a Safari tab becomes privileged execution later.
- `search` latency is measurable even when the response is unreadable, which is
  a slow but genuine exfiltration oracle against private notes.
- `GET /health` returning 200 lets any website fingerprint that this visitor
  runs Texttext.

Chrome shipped a Local Network Access prompt in 142 (October 2025) and Firefox
in 149, but Safari does not prompt at all, Chrome's protection does not yet
cover a page already on localhost or inside an Electron renderer, and none of it
applies to non-browser processes. Treat browser-side protection as absent.

DNS rebinding specifically **is** blocked, because a rebound name arrives with
`Host: evil.example:47118` and gets the 403. That is the one thing the loopback
Host check buys, and it is worth keeping.

---

## 2. What the MCP specification actually requires

From the Streamable HTTP transport section, normative and unchanged across
2025-03-26, 2025-06-18, 2025-11-25, and 2026-07-28:

> 1. Servers **MUST** validate the `Origin` header on all incoming connections
>    to prevent DNS rebinding attacks
> 2. When running locally, servers **SHOULD** bind only to localhost (127.0.0.1)
>    rather than all network interfaces (0.0.0.0)
> 3. Servers **SHOULD** implement proper authentication for all connections

We satisfy 2 and fail 1 and 3. Origin validation is the only MUST in the
warning, and we do not do it.

Two further points from the spec that bear directly on our design:

- The Security Best Practices document's "Local MCP Server Compromise" section
  says a local server **SHOULD** "Require an authorization token" or "Use unix
  domain sockets or other Interprocess Communication (IPC) mechanisms with
  restricted access". It names *malicious processes*, not just browsers, so
  Origin validation alone does not satisfy it.
- The 2026-07-28 revision makes `clientInfo` normatively untrusted:
  implementations "**SHOULD NOT** rely on them for security decisions". This
  matters to us specifically, see section 5.

---

## 3. What the field actually does

The honest summary: **almost nobody authenticates a local MCP server, and the
ones who do are the ones worth copying.**

No authentication at all (loopback binding plus the MCP client's own tool
prompts as the only consent):

- **Figma Dev Mode** (`127.0.0.1:3845`): no token, no header. Access control is
  "be signed into the desktop app with an eligible seat". Figma steers users to
  the remote OAuth server instead.
- **Paper** (`127.0.0.1:29979`): their docs call it "an authenticated MCP
  server", but no credential appears anywhere in setup. In practice this means
  "gated by the desktop app being open". Same posture as ours.
- **Blender** (`:9876`), **Ableton** (`:9877`), **Unity**: raw JSON over
  loopback TCP, no auth. Unity's own security review documents local mode
  actively *stripping* API-key headers.
- **Ollama** and **LM Studio**: unauthenticated by default. Ollama earned
  CVE-2024-28224 for exactly the rebinding case, fixed by adding Host validation.

Real local authentication, and these are the models:

- **Xcode 26** (Apple) is the best-in-class consent design: on first connection
  from a given client, macOS shows a pairing dialog naming the agent and showing
  the binary path and PID, and a human must click Allow before any tool call.
- **Obsidian Local REST API** is the best-in-class credential design: a 256-bit
  key generated on load, required as a bearer, compared in constant time, over
  HTTPS on a self-signed per-install cert, with plaintext HTTP off by default.
- **Home Assistant**: long-lived bearer token, aimed precisely at local agents
  that cannot run a browser OAuth flow.
- **1Password** is the most sophisticated split: where the peer's code signature
  is verifiable it verifies and does not prompt; where it is not verifiable
  (third-party SDKs) it resolves the caller's name and path, prompts the human
  with Touch ID, scopes the grant, and expires it after inactivity. Their
  documentation states plainly that "the user acts as the final validator".

So requiring a credential would put Texttext ahead of every creative-tool peer,
not behind. That is a product opportunity, not just a hardening chore.

### Client support is the gating constraint, and it is favorable

Verified against vendor documentation:

| Client | Can send a token to a local HTTP MCP server? | Mechanism |
|---|---|---|
| Claude Code | Yes | `claude mcp add --transport http x <url> --header "Authorization: Bearer t"` |
| Codex CLI | Yes | `config.toml`: `bearer_token_env_var`, `http_headers`, `env_http_headers` |
| Cursor | Yes | `mcp.json` `headers` with `${env:NAME}` |
| VS Code | Yes | `.vscode/mcp.json` `headers` plus `inputs` promptString |
| JetBrains AI | Yes, static token only | pasted bearer, no OAuth |
| Claude Desktop | **No** (stdio-only config) | needs an `mcp-remote` bridge |
| claude.ai connectors | **No** (OAuth-only, no header field) | needs a real OAuth flow |

Our two documented local clients, Claude Code and Codex CLI, both support a
required token today. That is the whole feasibility question, and the answer is
yes.

---

## 4. Threat model, and the honest limit

Attacker classes against `:47118` today, and what each mitigation removes:

| | Origin reject | Bearer token (0600 file) | Pairing that mints a token | Peer PID + code signature | Unix socket |
|---|---|---|---|---|---|
| Malicious web page | **yes** | yes | yes | no | **yes** |
| Local non-sandboxed process | no | no | no | naive only | no |
| Sandboxed process (App Store app) | no | **yes** | yes | partial | **yes** |
| npm package in a dev shell | no | no (noisy with Keychain ACL) | no | **structurally no** | no |
| Another user account on the Mac | no | **yes** | yes | partial | **yes** |
| A paired client that goes rogue | no | no | scope limits blast radius | no | no |
| Port squatter / impostor server | no | partial | partial | no | **yes** |

**The honest limit: a same-user non-sandboxed process can always reach this, and
no design on this list changes that.** That is a property of the OS, not of our
code. Keybase documents the same limit and calls it out of scope. What is
achievable is removing the browser class completely, removing the other-user and
sandboxed classes completely, making the local-process class noisy and
attributable rather than silent, and bounding what a consented client can do.

**Why peer code-signature verification is a trap.** It looks like the strongest
answer and it is not. Claude Code and Codex are Node processes, so any allowlist
that admits them admits every npm package running inside the same interpreter.
There is no code-identity boundary between "Claude Code calling the bridge" and
"a malicious dependency inside Claude Code calling the bridge". Worse, over TCP
there is no kernel-attested peer credential: you would map an ephemeral port to
a PID by scanning, which is the same PID-reuse race that produced CVE-2020-14977
and which Apple explicitly steers developers away from. Use peer identity to
*label a consent prompt*, never to make the authorization decision.

---

## 5. Findings that are not about authentication, and are arguably worse

The sweep surfaced five defects that hold regardless of which trust model is
chosen. Two of them undercut invariants the product already claims.

1. **Port squatting, and the impostor is the nastier direction.**
   `allowLocalEndpointReuse = true` (`:122`) plus a fixed published port plus no
   server authentication lets a local process co-bind or pre-bind `47118`. A
   failed bind only logs (`:141`). The impostor then serves `tools/list` whose
   tool *descriptions* are prompt injection delivered straight into Claude Code
   or Codex, which hold shell authority, and harvests whatever the agent sends.
   This attacks the agent, which is the more privileged party. Remove the reuse
   flag.

2. **The audit trail cannot see this transport.** Local MCP calls run through
   `/api/ai/tools` as the signed-in session, and `runWorkspaceToolForSession`
   hardcodes `clientId: "in-app-assistant"` and `actorType: "ai"`
   (`src/lib/mcp/tools.ts:1996-2010`). So a web-page-driven mutation and the
   owner's own sidebar request write identical `action_audit` rows. This
   contradicts `docs/ai-sidebar-architecture.md:22-24`, which promises
   per-connection attribution. After an incident there is no way to tell the two
   apart.

3. **The confirmation dialog is not a security boundary.** It never says who is
   asking (`PostWorkspaceShell.tsx:6527-6534`); it holds a single pending
   resolver and settles the previous one as false when a new request arrives
   (`confirmation.ts:32`), which is a dialog-swap race an attacker can retry
   indefinitely against an unrated port to get `set_access` approved by the
   owner's click; and it renders inside a WKWebView that may not be visible,
   since the app runs windowless from the menu bar.

4. **No request deadline and no connection cap** (`:154-198`). A pending
   confirmation with the window closed never resolves, so the connection never
   closes. A handful of those wedge the endpoint.

5. **The local transport has no scope concept.** The bridge hands every caller
   all 30 tools (`useNativeAssistant.ts:361`), while hosted MCP distinguishes
   `read` from `sync`. A read-only local connection cannot currently be
   expressed.

And one that bears on the collaborator feature shipped in 0.142: **`clientInfo`
is attacker-declared**, so any local caller can present as "Codex" or "Claude"
with the right avatar and brand color. The presence route correctly prevents
impersonating another *person* (the user id comes from the session), but it
cannot prevent impersonating a *product*. The 2026-07-28 spec now says outright
that implementations should not rely on `clientInfo` for security decisions.
Presence should be labeled as self-declared until a pairing step makes it real.

---

## 6. Recommendation

### Tier 0, ship now, no UX change

This closes the live hole in section 1 and satisfies the spec's only MUST.
Roughly ten lines in the request guard at `LocalAgentServer.swift:200`, plus
small fixes.

- Reject any request carrying an `Origin` header, or a cross-site
  `Sec-Fetch-Site`. Legitimate MCP clients do not send `Origin`; browsers always
  do and cannot forge it. This removes the entire malicious-web-page class.
- Require `Content-Type: application/json` strictly, which forces a preflight
  for any browser and kills the simple-request path.
- Add an explicit `OPTIONS` returning 405 with no CORS headers.
- Remove `allowLocalEndpointReuse`.
- Add a per-request deadline and a concurrent-connection cap.
- Correct `AppHealthReporter.swift:722-741` and `LocalAgentServerTests.swift`,
  which currently assert "loopback only" as though it were the security
  property.

Also in this tier, because they are integrity bugs rather than auth design:
distinct actor type plus connection identity in `action_audit`; name the caller
in the confirmation dialog and queue rather than replace pending requests.

### Tier 1, the product feature: OAuth on the loopback endpoint

Require authorization on `:47118` and satisfy it with the flow this product
already ships for hosted MCP, rather than inventing a second scheme. See the UX
section below for why this is the expected design and not merely the safe one.

- An unauthenticated call gets 401 plus `WWW-Authenticate` pointing at the
  existing protected-resource metadata. The client runs the flow itself: Codex
  defaults to `auth = "oauth"` for HTTP MCP servers, and Claude Code performs
  OAuth for HTTP servers through `/mcp`.
- The user sees the authorize page they already know
  (`src/app/oauth/authorize/page.tsx:91-130`), naming the client and offering
  read-only versus read-write. That page is the consent moment and the scope
  choice; no new native dialog is needed for connection consent.
- The grant is per client, so the collaborator identity derives from the token
  rather than from spoofable `clientInfo`, which makes the 0.142 avatar verified.
- Paired agents appear in the existing connected-apps list with per-client
  revoke (`ConnectPanel.tsx:272-334`). Revocation and inventory come free.
- **The documented connect command does not change**, so setup friction is
  identical to today.

Reuses `createApiToken`, the approve route, and the RFC 8707 resource-indicator
support from `04c0423`. Spike the loopback token-validation path and audience
binding first; the fallback if that fails is a per-client bearer inlined into the
generated command, which is still better than today. Claude Desktop and
claude.ai connector users stay on hosted MCP either way, since neither can reach
a local HTTP server at all.

A native prompt is still the right surface for **consequential actions**
(publish, share, delete), per section 5: named, queued, and native so it is
visible when the window is closed. That is separate from connection consent.

### Tier 2, the structural end state, not now

Replace the TCP listener with a Unix domain socket plus a small stdio bridge
binary in the app bundle:

```
claude mcp add texttext -- /Applications/Texttext.app/Contents/MacOS/texttext-mcp
```

This removes the browser, other-user, sandboxed, and squatter classes *by
construction* rather than by filtering, gives kernel-attested peer credentials
via `LOCAL_PEERCRED` so peer identification becomes sound instead of racy, and
makes each client launch a natural pairing event. It is the same move Chrome
made with `--remote-debugging-pipe` after concluding a port could not be
secured. The cost is that MCP clients cannot speak AF_UNIX directly, hence the
bridge binary.

### The UX, which is the part that decides whether Tier 1 is worth doing

**The expected UX is the one this product already implements for hosted MCP:
OAuth. The local path is the only surface that does something else.**

Texttext already has a complete "connect an agent" flow: `/connect`, an
authorize page that names the client and offers read-only versus read-write
(`src/app/oauth/authorize/page.tsx:91-130`), a connected-apps list with per-client
revoke (`ConnectPanel.tsx:272-334`), and token minting through `createApiToken`.
Users do not expect a second, different mechanism because the server happens to
be on loopback. They expect what every integration does: point the client at it,
get asked to authorize, approve, see it in a list you can revoke from.

The decisive detail: **the connect command does not change.**

```
claude mcp add --transport http --scope user texttext http://127.0.0.1:47118/mcp
```

That is the command today and the command after. The server answers an
unauthenticated call with 401 plus `WWW-Authenticate` discovery metadata and the
client runs the flow itself. This works because `auth = "oauth"` is Codex's
**default** for HTTP MCP servers, and Claude Code performs OAuth for HTTP servers
via `/mcp`. Neither needs a flag, a header, or a visible secret.

What this gets that a bearer-in-the-command does not:

- **No credential in shell history or in a plaintext client config.** A token
  pasted into `claude mcp add --header` lands in both. That is the documented
  failure of the Jupyter model (tokens leaking into history, logs, referrers),
  so copying it would be adopting a known flaw.
- **A real consent moment**, in-product, naming the client, with the scope choice
  on the approve page where it belongs rather than split across two different
  shell commands to copy.
- **One auth model instead of two.** Today: hosted OAuth plus local nothing. A
  bearer scheme would make it hosted OAuth plus local bearer. OAuth for both
  means one consent surface, one revocation list, one mental model.
- **Verified client identity for free.** The grant is per client, so the
  collaborator identity comes from the token rather than from spoofable
  `clientInfo`, which is exactly the fix section 5 calls for.
- **Reuses shipped code**: the authorize page, the approve route,
  `createApiToken`, the connected-apps list, and the RFC 8707 resource-indicator
  support added in `04c0423`.

Feasibility questions to spike before committing:

1. How the loopback server validates a token minted by texttext.app. The
   natural path is forwarding the `Authorization` header through the page bridge,
   which already holds an authenticated session, but that is a round trip and
   needs designing.
2. Audience binding for a loopback resource (`http://127.0.0.1:47118/mcp`)
   against the existing resource-indicator implementation.
3. Network is required for the initial authorize. Not a new constraint, since
   the bridge already calls `/api/ai/tools`, but it should be stated.

**Fallback if the spike fails.** A per-client bearer token inlined into the
generated connect command. Friction is still unchanged, because
`ConnectPanel.tsx:62-65` writes the command for the user, and both documented
clients accept headers. It is strictly better than today, and strictly worse
than OAuth on the three counts above. Treat it as the fallback, not the plan.

**Do not copy Xcode's pairing dialog.** It is the best-designed consent surface
in the field and it is failing in practice: it re-prompts per launch and per
`/clear`, CLI clients without a bundle identifier hang on it, and users ship
AppleScript auto-clickers to defeat it. A prompt that users automate away is
worse than no prompt, because it launders consent: the appearance of a human
decision with none of the substance. A prompt must be rare and consequential or
it becomes a click-through.

The consent act is the paste. A user who copies a credential out of their own
workspace and hands it to a named agent has consented more deliberately, and
with better information, than one who clicks Allow on a dialog that appeared
while they were in Terminal. A dialog on top of that is double consent.

**Never prompt on a failed or unknown connection.** That is a phishing
primitive: an attacker connects, the prompt appears, the user clicks yes to
dismiss it. An unpaired client gets a 401 whose body says how to pair, and
nothing more.

Friction is justified in exactly one place: audience-changing and destructive
actions (publish, share, delete). Keep that confirmation, fix it per section 5
(name the caller, queue rather than replace, native so it is visible when the
window is closed). Note that MCP clients already run their own per-tool approval
layer; ours governs which app may connect, theirs governs which tool may run, so
the two should not duplicate each other.

**Make the token per client and named**, and derive the collaborator identity
from the token rather than from `clientInfo`. That single change closes the
spoofing hole in section 5 and makes the 0.142 avatar verified rather than
self-declared, while giving per-agent revocation instead of all-or-nothing.

Resulting comparison:

| | Figma / Paper (the expectation) | Xcode 26 | Recommended |
|---|---|---|---|
| Setup | one command | one command | one command, unchanged |
| First connect | nothing | OS dialog, recurring | nothing |
| While working | invisible | dialog fatigue | avatar plus cursor (shipped in 0.142) |
| Consequential action | client's own prompt | client's own prompt | named native confirm |
| Revoke | impossible | unclear | one click in Connect |
| Attribution | none | none | per-agent audit rows |

Scope choice belongs in the same surface: offer a read-only and a read-write
command side by side, the way the hosted OAuth consent already distinguishes
`read` from `sync`, rather than hiding the distinction.

### Explicitly not recommended

- **Port randomization.** A local process reads the discovery file or runs
  `lsof`; a page port-scans by timing. It buys obfuscation and costs the stable
  documented URL.
- **Peer code-signature verification as authorization**, for the Node-interpreter
  and PID-race reasons in section 4. Worth doing only to label a prompt, and only
  once it rests on an audit token rather than a PID.

---

## 7. The bottom line

Tier 0 is not really a decision. There is a live blind-write CSRF path from any
web page today, the fix is about ten lines, it costs no UX, and Origin validation
is the specification's only MUST for this transport. It should ship whether or
not anything else does.

Tier 1 is the real decision, and it turns out to be less of a tradeoff than it
first appears. The question is whether connecting a local agent is the one
surface in this product that skips authorization, or whether it works the way
every other connection already does. Extending the existing OAuth flow to the
loopback endpoint leaves the documented connect command untouched, so the choice
is not friction versus safety: it is one auth model versus two, a real consent
moment versus none, and a verified agent identity versus a self-declared one.
For a product where an agent can rewrite everything the owner has written, and
where the avatar shipped in 0.142 currently vouches for a claim the server cannot
check, that is the honest design. No competitor in this category has it.

Tier 2 is the direction of travel. Worth committing to on paper so Tier 1 is
built in a way that survives the transport change, but not worth doing now.

## Sources

MCP specification transports and security best practices (2025-03-26 through
2026-07-28); CVE-2025-49596 (MCP Inspector drive-by RCE, fixed with a session
token plus origin allowlist, explicitly modeled on Jupyter); CVE-2024-28224
(Ollama DNS rebinding); CVE-2019-13450 (Zoom localhost server, removed by Apple's
malware removal tool); CVE-2020-14977 and the macOS XPC PID-reuse class;
CVE-2025-66414 (MCP TypeScript SDK, rebinding protection off by default);
Oligo's 0.0.0.0-day; Chrome Local Network Access in 142 and Firefox 149;
Discord RPC origin allowlist; Jupyter token model; Chrome DevTools
`--remote-debugging-pipe`; Tailscale sameuserproof and its retirement in favor of
XPC plus Keychain; 1Password app integration security; Obsidian Local REST API;
Xcode 26 MCP pairing dialog; Figma, Paper, Blender, Ableton, Unity, Ollama, and
LM Studio local server postures.

---

## Record: Tier 0 shipped 2026-07-29

The hole was demonstrated live against the shipped 0.142 build before the fix.
This request returned the full tool list:

```
curl -X POST http://127.0.0.1:47118/mcp \
  -H 'Content-Type: text/plain' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

`text/plain` is CORS-safelisted, so a browser sends it with no preflight, and the
server never inspected the content type. That is the whole exploit.

What shipped, all in `mac/Sources/Write/LocalAgentServer.swift`:

- `rejection(for:)`, a `nonisolated static` pure guard, so the health reporter
  and the tests run the exact code the server runs rather than a proxy for it.
- Refuse any request carrying `Origin`, or a `Sec-Fetch-Site` other than `none`.
  Both are forbidden header names, so script can neither forge nor remove them.
  `none` stays allowed so a human can still open `/health` in a browser.
- Require strict `application/json`. This is the load-bearing line: that media
  type is not CORS-safelisted, so a browser POST must preflight.
- Explicit `OPTIONS` returning 405 with `Allow` and no CORS headers, so the
  preflight fails.
- Numeric loopback hosts only, with a 403 that names the fix for the one
  legitimate case (a hand-typed `localhost:47118`).
- `X-Content-Type-Options: nosniff` on every response.
- A 120 s request deadline and a 16-connection cap, via a settle-once
  `LocalAgentChannel` so the deadline and the response cannot both write to one
  socket, plus a lock-guarded `LocalAgentConnectionLimiter`.
- Listener state is recorded (`isListening`) and a bind failure is logged
  prominently, because a process squatting the port previously failed silently.

**`allowLocalEndpointReuse` was deliberately kept**, against the initial
recommendation. `release/ship.sh` quits and relaunches the app well inside the
30 s TIME_WAIT window, so removing it would make the relaunched app fail to
bind. On BSD this flag permits rebinding a port in TIME_WAIT, not co-binding a
live listener, so it is not the squatting risk. The real defect was that a bind
failure was invisible, which is what `isListening` and the log now address.

Coverage: 29 tests in `mac/Tests/WriteTests/LocalAgentServerTests.swift`, a
rewritten `checkLocalAgentBridge` in `AppHealthReporter.swift` that exercises the
guard instead of asserting `loopback_only` as though it were a security
property, and eight assertions in `scripts/verify-agent-interoperability.ts`
(a release gate), each verified to fail against a simulated regression.

### What Tier 0 does NOT do

It authenticates nothing. Any program running as you can still drive the
endpoint, and that is by design, since it is the attacker class the decision
explicitly scopes out. It also leaves the three product gaps that Tier 1 would
close: the collaborator badge is still self-declared and forgeable, there is no
list of connected local agents and no revoke, and every local agent still gets
all 30 tools with no read-only option.
