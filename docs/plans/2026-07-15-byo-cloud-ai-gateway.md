# BYO-cloud AI rung via Vercel AI Gateway (implementation plan)

Status: FOUNDATION IN (the `ai` SDK is installed), route not yet built. Owner
decisions locked: use the Vercel AI Gateway; server-side tool execution;
off by default. This is the ready-to-execute plan; kept precise so the build is
fast and careful (a cloud model mutating user content deserves the same
adversarial-review rigor the collab work got).

## Goal

On the plain web (and any non-Mac client), make the assistant sidebar actually
work: answer, and run the same workspace commands (create/edit/move/trash/etc.)
through a cloud model. Local-first stays the default: on-device runs when
present; cloud is the fallback, and only when explicitly enabled.

## Architecture: the cloud loop is the third consumer of the one command surface

The key reuse: `executeMcpTool(name, args, extra)` in `src/lib/mcp/tools.ts` is
the single server-side executor behind every MCP tool. It already enforces every
invariant we care about (per-item access, notes/bookmarks unlisted forever,
`action_audit` on every mutation, revision CAS). The cloud loop reuses it
verbatim, so there is no parallel command system and no re-implemented security.

1. **Export a session executor** from `src/lib/mcp/tools.ts`:

   ```ts
   export async function runWorkspaceToolForSession(
     name: WorkspaceToolName,
     args: Record<string, unknown>,
     actor: { sub: string; userId: string | null },
   ): Promise<CallToolResult> {
     const extra: ToolContext = {
       authInfo: {
         token: "session",
         clientId: "in-app-assistant",
         scopes: [WORKSPACE_SCOPE_CAPABILITIES.fullAccess],
         extra: { sub: actor.sub, userId: actor.userId },
       },
     };
     return executeMcpTool(name, args, extra);
   }
   ```

   `AuthInfo` = `{ token, clientId, scopes, expiresAt?, extra? }`;
   `accessUser` reads `authInfo.extra.{sub,userId}`; `resolveMcpScopeAccess`
   grants writes on `WORKSPACE_SCOPE_CAPABILITIES.fullAccess`. Per-item access is
   still enforced from the resolved user, so full-access scope does not bypass
   sharing. NOTE: the executor records `actorType: "external_agent"`; consider a
   distinct in-app/`ai` actor label as a small follow-up so the audit
   distinguishes the built-in assistant from external MCP agents.

2. **Adapt to AI SDK tools** (`src/lib/ai/cloud-tools.ts`): for each
   `WORKSPACE_TOOL_DEFINITIONS[name]`, build a `tool({ description, inputSchema,
   execute })` whose `execute(args)` calls `runWorkspaceToolForSession` and
   returns the `CallToolResult` text (surface `isError` as a tool error). The
   input schemas already exist as the canonical definitions.

3. **`/api/ai` route** (`src/app/api/ai/route.ts`), Node runtime:
   - Gate: if `process.env.AI_GATEWAY_API_KEY` is unset, return 404/disabled.
     This IS the off-by-default opt-in: setting the key (owner, env) enables it.
   - Auth: `getCurrentUser()`; resolve the owned workspace; 401 if signed out.
   - `streamText({ model: 'anthropic/claude-sonnet-5', system, messages, tools,
     stopWhen: stepCountIs(8) })` and return `.toUIMessageStreamResponse()` (or
     the current streaming response helper; verify against `node_modules/ai/docs`
     at build time, per the ai-sdk skill: never code the API from memory).
   - `system`: the base writing context + the same tool-use guidance the native
     agent uses; carry the sidebar's context snapshot (level, folderPath, postId)
     so item ids stay authoritative.
   - Model id fetched live (`anthropic/claude-sonnet-5` was newest on
     2026-07-15); re-verify with the gateway models list before shipping.

4. **Capability probe**: extend the assistant's availability check so the web
   client learns cloud is enabled (`GET /api/ai` or a small
   `/api/ai/capabilities`). Local-first: the client uses the on-device bridge
   when `hasNativeAI()`, and only falls back to `/api/ai` when the bridge is
   absent AND cloud is enabled.

5. **Client wiring** (`useNativeAssistant`/`ln` + `AssistantConversation`): when
   falling back to cloud, POST the conversation to `/api/ai` and render the
   streamed text + tool-call progress in the existing assistant UI. Reuse the
   existing confirmation gates for destructive tools.

## Gating, cost, privacy

- Off by default (`AI_GATEWAY_API_KEY` unset). Owner-controlled.
- Cost model: the gateway key is app-level, so the APP pays for cloud usage. Off
  by default bounds exposure; if users should bear their own cost, the
  alternative is per-workspace BYO keys (each workspace pastes its own), which
  flips the bill to them. Revisit alongside monetization.
- No provider secret in a Markdown folder (the key is env only). Preserves the
  local-first default and the same workspace contract.

## Tests + verification

- Unit: `runWorkspaceToolForSession` builds the right scopes and delegates to
  `executeMcpTool`; the cloud-tools adapter maps a `CallToolResult` (text and
  `isError`) correctly; the route is disabled without the env key and 401 without
  a session.
- Golden: a create/edit tool call routes through the executor and writes an
  `action_audit` row (reuse the live workflow verifier pattern).
- Gate: `python3 scripts/test-oauth-mcp-loop.py` must still pass (the executor is
  unchanged; only a new caller is added).
- Adversarial review before ship: auth scope correctness (no privilege
  escalation past sharing), streaming abort + runaway-step bounds, cost bounds,
  and that the local-first fallback never sends content to cloud when on-device
  is available or cloud is disabled.

## Effort

~1 focused day including the client streaming wiring and the review. The server
half (executor export + adapter + gated route + unit tests) is a clean first
increment; client streaming + probe + review + ship is the second.
