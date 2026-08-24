# Agentic assistant implementation runbook

This is the implementation and maintenance reference for TextText's agentic
assistant as of 2026-08-24. It exists so a future Codex, Claude, or human
engineer can distinguish the product surfaces, follow a turn end to end, and
change one layer without accidentally weakening another.

Read this together with:

- `AGENTS.md` for the project contract and release prohibitions
- `docs/ai-sidebar-architecture.md` for the system overview and generated tool
  contract
- `docs/agentic-text-product.md` for the product promise and honest parity
  ledger
- `docs/agent-interoperability.md` for the external CLI and hosted MCP
  transports
- `docs/HANDOFF.md` for the latest verified build facts

When prose and source disagree, source, migrations, and tests are authoritative.
Correct the documentation in the same change. Do not preserve a stale claim
because another document once said it.

### Fast routing for future sessions

| If the task changes... | Read these sections first |
| --- | --- |
| provider setup, model selection, or provider requests | Ownership and scope resolution; Cloud turn, end to end; Add or change a model |
| chat identity, reload, or multi-device continuity | Conversation lifecycle; Change conversation persistence |
| a TextText workspace tool or any assistant write | Cloud workspace proposal state machine; Provenance and receipts; Add or change a workspace tool |
| a third-party MCP connection or remote tool | Outbound MCP flow; Change outbound MCP |
| the standalone Mac assistant | Native turn and workspace fence; Change native integration |
| attachments, OCR, or Office extraction | Attachments |
| Settings connection inventory | Settings and connection inventory |
| sandboxing, Store eligibility, or distribution | Edition matrix; Non-negotiable invariants |
| a product claim about Pen, Paper, or Notion parity | Deliberate gaps; `docs/agentic-text-product.md` |
| a release-readiness claim | Verification; the newest proof in `docs/HANDOFF.md` |

## Vocabulary that must remain distinct

Several different features are casually called "AI integration." They are not
the same trust boundary.

| Name | What it means | Authentication | Where the model runs | Write behavior |
| --- | --- | --- | --- | --- |
| Cloud in-app assistant | The right rail using a workspace-owned Anthropic or OpenAI key | Signed-in workspace owner plus exact workspace handle | Provider HTTPS API | Reads execute immediately. Eligible writes become durable owner-review proposals. |
| Native in-app assistant | The right rail using the standalone Mac app's Codex App Server | Signed-in workspace owner plus native owner/workspace/conversation fence | Local Codex runtime using the eligible connected account | Canonical tools execute through the app command surface. Confirmation-marked operations still require the app confirmation callback. |
| Local external agent | Claude Code or Codex using the bundled `texttext` CLI | Signed-in app device credential | The external client | Direct authenticated command route with audit, idempotency, and conflict checks. No localhost server. |
| Inbound hosted MCP | An external AI client calling TextText's `/api/mcp` | Revocable workspace bearer token | The external client | The token scope and canonical command executor authorize each call. |
| Outbound MCP | The cloud in-app assistant using a third-party MCP server | Signed-in owner, enabled connection, exact `@mcp:<slug>` request, then proposal approval | Cloud provider plus remote MCP server | Discovery occurs only for the exact requested connection. Every remote tool call is an inert proposal until approval. |
| Native item-type utility turn | A hidden native turn used by the item-type studio | Same native owner fence | Local Codex runtime | Only `preview_item_type` is accepted. It uses a private conversation id and cannot enter visible chat history. |

The web app never calls its own `/api/mcp`. The standalone local agent path
never restores the retired loopback server. Inbound MCP and outbound MCP are
opposite directions and must not share authorization assumptions.

## Non-negotiable invariants

1. The assistant is owner-only. Collaborator edit access is not assistant
   authority.
2. The displayed workspace handle must equal the caller's owned workspace
   before provider configuration, history, native status, tools, or context are
   exposed.
3. `src/lib/store.ts` is the only content access boundary. AI adapters use the
   shared workspace command surface and do not write tables directly.
4. Notes and bookmarks remain private and unlisted through every adapter.
5. Search results are Found, not Read. Only exact access-checked content supplied
   to the model may produce a Read receipt.
6. Model prose never creates provenance, a command receipt, or proof of a side
   effect.
7. Eligible cloud writes are proposals, not completed changes. The UI may say a
   write completed only after the decision route returns a validated receipt.
8. Every outbound MCP call requires exact owner review even when the remote
   server claims the tool is read-only.
9. An ambiguous post-side-effect failure is terminal. Never offer a blind retry.
10. Native events require the initiating opaque owner scope, workspace handle,
    and conversation id. Missing or late events fail closed.
11. Store builds compile local process launch and local MCP machinery out. Do
    not replace compile-time exclusion with a hidden runtime toggle.
12. Releases, TestFlight uploads, deployments, and release records are separate
    owner decisions. Passing this runbook's source gates is not authorization to
    perform them.

## Canonical data model

The relevant tables live in `src/lib/db/schema.ts`. Their migrations are part
of `scripts/run-release-migrations.sh` and `npm run db:push`.

### `workspace_ai_config`

One row per workspace. It stores the allowlisted provider and model plus an
encrypted API key. `src/lib/ai/workspace-ai-config.server.ts` is the only
module that decrypts the key for a provider request. The browser receives only
connection status, provider label, and model. The key is write-only in Settings.

Migration: `scripts/migrate-add-workspace-ai-config.mjs`.

### `workspace_agent_config`

One row per workspace. It stores the owner's standing instructions and a JSON
array of reusable skills. Validation is centralized in
`src/lib/ai/agent-instructions.ts`:

- standing instructions: 8,000 characters
- skills: 12 maximum
- skill name: 48 characters
- trigger: 1 to 32 lowercase letters, numbers, or dashes
- instructions per skill: 4,000 characters
- all skill instructions combined: 20,000 characters

Only Settings values enter the trusted owner-instruction prompt section. A
skill activates only when the current request explicitly contains its
displayed `/trigger` or `@trigger`. Documents, selections, search results, tool
output, and remote text never enter this authority channel.

Migration: `scripts/migrate-add-workspace-agent-config.mjs`.

### `workspace_assistant_conversation_history`

One bounded owner-only replica per workspace. The browser remains local-first;
this row lets the owner's devices converge. Collaborators cannot read or write
it. The server stores a sanitized JSON array, not provider credentials.

Limits in `src/lib/ai/assistant-conversation-sync.ts`:

- 60 conversations per workspace
- 200 messages per conversation
- 16,000 text characters per message
- 512 KB serialized per conversation
- 4 MB serialized per workspace
- timestamps more than five minutes in the future are rejected or normalized

Secret-looking keys are removed and recognizable bearer, API-key, password,
and workspace-token values are replaced with `[redacted]` before sync.

Migration: `scripts/migrate-add-assistant-conversation-history.mjs`.

### `ai_write_proposals`

The durable state machine for both cloud workspace writes and outbound MCP
calls. A proposal is bound to the workspace, actor user, kind, stored tool name,
stored arguments, expiry, and optional connection. Status is one of `pending`,
`executing`, `completed`, `denied`, or `failed`.

The default lifetime is 15 minutes and the hard maximum is 30 minutes. Workspace
proposal arguments are capped at 1,050,000 serialized bytes. Outbound arguments
are capped at 64 KB and the frozen remote definition at 256 KB.

Migration: `scripts/migrate-add-ai-write-proposals.mjs`.

### `mcp_connections`

Outbound connection configuration. A new connection starts disabled. Its token
is encrypted and never returned to the browser. The display name is also its
assistant shortcut namespace. New names are rejected when their normalized
slug would collide with an existing name.

### `action_audit`

The accountability record. Proposal creation, approval, denial, completion,
failure, canonical workspace mutations, inbound MCP mutations, and connected
agent actions all write attributed audit rows. Account deletion anonymizes the
actor reference without deleting the event history.

## Ownership and scope resolution

Owner gating exists on both the server and client because neither is a
substitute for the other.

### Server boundaries

- `GET /api/ai?workspaceHandle=...` returns provider metadata only when the
  requested handle exactly matches `getOwnedBlog(user.sub)`. Otherwise it
  returns the disabled shape with `private, no-store`.
- `POST /api/ai` resolves the signed-in owner's workspace before reading the
  provider configuration. The request's `workspaceHandle` must exactly match.
- `POST /api/ai/tools` repeats the exact owned-workspace check before user-id
  resolution or `runWorkspaceToolForSession`. This route is a privileged
  in-app transport, not a collaborator command endpoint.
- `POST /api/ai/proposals/[id]` resolves the signed-in owner's workspace and
  passes only the opaque proposal id plus `approve` or `deny`. The browser
  cannot replace the stored tool or arguments.
- instruction, skill metadata, and conversation sync server actions resolve
  edit access and additionally require the caller to be the workspace owner.
- `POST /api/ai/item-type` uses the owned workspace, not the displayed
  collaborator view.

### Client boundary

`useNativeAssistant` requests an opaque conversation-cache scope from
`getAssistantConversationCacheScopeAction(handle)`. Only an owner receives one.
Until the result belongs to the currently displayed handle and contains a
scope, `ownerScopeReady` is false.

While false, the UI:

- hides transcripts, jobs, provider identity, and native connection state
- disables submission, quick actions, selection actions, item-type generation,
  attachment controls, and native connect
- does not register native tools or request native runtime status
- preserves the person's unsent draft while the check resolves

The local conversation store key is `<handle>:<opaque-owner-scope>`. The opaque
component prevents one account's browser replica from being reused for another
account merely because both viewed the same public handle.

Do not replace the owner check with collaborator `edit` access and do not derive
the local key from the handle alone.

## Conversation lifecycle

The browser implementation is split deliberately:

- `conversation-store.ts`: local-first records, active chat, search, pinning,
  migration, persistence, and subscription
- `assistant-conversation-sync.ts`: untrusted payload cleanup, deterministic
  merge, secret scrubbing, clocks, and size limits
- `assistant-conversation-history.server.ts`: owner-only database load and
  compare-and-merge
- `assistant-conversation-actions.ts`: server-action ownership boundary
- `AssistantConversationHistory.tsx`: history UI

Collections are keyed by stable context, including workspace, folder, Trash,
Shared with me, and item contexts. A conversation has a stable id. The runtime
thread key is `<owner-store-key>\u001f<conversation-id>`.

Local mutations notify the UI immediately. After a 900 ms quiet period, the
owner replica is sanitized and synchronized. Merge is deterministic:

- records merge by stable id
- newer valid timestamps win
- equal timestamps use canonical serialized content as a deterministic tie
- pinned conversations sort before unpinned, then by activity and id
- messages preserve their own ids, so two devices do not duplicate one message
- terminal proposal state is never replaced by a stale pending client copy

Cloud and native context use the last 20 user/assistant messages, at most 8,000
characters per message and 32,000 characters total. Progress and error rows do
not become model dialogue.

For the native path, Swift maps durable conversation ids to ephemeral Codex
thread ids in `CodexConversationThreadRegistry`. When a durable conversation is
attached to a fresh thread after relaunch, the bounded transcript is inserted
once. A conversation already mapped to a live thread does not receive the
history again, preventing duplication.

Item-type design uses an id beginning with `item-type:` and never the visible
conversation id.

## Cloud turn, end to end

1. `AssistantSidebar` captures text, explicit TextText context, files, selected
   model preference, and the stable current view.
2. `useNativeAssistant.submit` captures the owner store key, conversation id,
   thread key, and view before any asynchronous work.
3. If native is unavailable, `cloud-client.ts` sends bounded history and context
   to `POST /api/ai` and consumes its NDJSON stream.
4. The route authenticates the owner and exact workspace before resolving the
   encrypted provider key.
5. `provider-catalog.ts` validates the exact model. Auto deterministically picks
   the fast model only for a short, context-free request; files, workspace
   context, broad synthesis, or editing use the stronger model. The completed
   answer records the actual model id.
6. The route builds the trusted TextText system prompt, then separately fences
   all document, selection, preview, recent-index, related-item, and remote data
   as untrusted.
7. The owner instruction suffix is appended only after server-side validation.
8. A recent workspace request receives at most 12 access-checked index entries.
   These create Found evidence. Explicitly attached TextText items are read by
   stable id and create Read evidence.
9. The latest user request is parsed for exact outbound shortcuts. Only matching
   enabled connections are discovered.
10. The model receives immediate read tools, proposal-producing eligible write
    tools, and proposal-producing tools for the explicitly requested remote
    connection. Confirmation-gated and open-world workspace tools are absent.
11. The provider loop stops after at most eight tool steps. Stop aborts the
    provider request.
12. The stream carries progress, text, provider/model identity, validated
    workspace calls, source context items, outbound status, unreachable servers,
    and proposal previews.
13. The client attaches every update to the originally captured thread even if
    the person switches chats. Artifact cards are derived from validated call
    output and context items, never parsed from answer prose.

The cloud provider never receives an arbitrary model id from the browser. An
invalid selection falls back to the saved allowlisted model.

## Cloud workspace proposal state machine

`guardedCloudAssistantTools` exposes reads for immediate execution. A write is
exposed only when its canonical definition has `mutability: write`,
`confirmation: none`, and no `openWorldHint`. Publishing, access, restore,
Trash, destructive assets, and model-selected network fetches are not merely
rejected later; they are omitted from the cloud tool map.

Proposal flow:

1. The model supplies a canonical tool name and arguments.
2. `validateWorkspaceWriteProposal` reuses the canonical tool schema and stores
   validated data in `ai_write_proposals` as `pending` with an audit row.
3. The assistant receives only an approval-required result and opaque proposal
   id. No workspace mutation has happened.
4. The owner reviews the exact stored summary and fields in the conversation.
5. The decision route accepts only the id and decision.
6. Approval atomically changes a still-pending, unexpired, owner-bound row to
   `executing` and writes the approval audit.
7. The server rereads and revalidates the stored database arguments. The
   browser cannot substitute them.
8. The canonical workspace executor runs once.
9. Completion stores a durable receipt and completion audit. The client adds
   proof and refreshes the pool only when the response is approved and the
   receipt kind is `workspace`.

Denial is also an atomic terminal transition. If another device already
completed or denied the proposal, a stale approval or denial returns the
authoritative receipt or denial. The client merge is monotonic and does not
resurrect pending state.

If the workspace command returned success but receipt persistence failed, the
server returns HTTP 202 with terminal ambiguity. The UI shows a verification
message and no retry control. Treating this as an ordinary failure could execute
the mutation twice.

## Outbound MCP flow

Outbound MCP begins inert. Adding a connection validates it but saves it off.
Enabling it permits later explicit use, not background discovery.

### Discovery authorization

`explicitlyRequestedOutboundConnections` accepts only literal tokens matching
`@mcp:<connection_slug>` in the current request. Settings displays the exact
shortcut. Bare names, phrases such as "with drive," earlier turns, enabled
state, and model inference do not authorize discovery.

Connection slugs are normalized from the display name. New collisions are
rejected; legacy collisions fail closed and select nothing.

### Prompt-injection boundary

Remote names, descriptions, schemas, annotations, and results are untrusted
data. Remote tools receive a namespace such as `paper__create_frame`, which
cannot shadow a TextText workspace tool. A claimed `readOnlyHint` is display
metadata, never permission to execute during answer generation.

### Approval boundary

Every remote tool invocation calls `createOutboundMcpProposal`; it does not
contact the third-party tool. The stored metadata freezes:

- connection id and display name
- HMAC fingerprint of connection id, name, URL, and protected token value
- remote tool name, description, JSON schema, and annotations
- SHA-256 fingerprint of the frozen remote definition
- exact schema-validated arguments

On approval the server re-resolves an enabled connection, compares the
protected destination fingerprint, rediscovers the tool, compares its full
definition fingerprint, validates the stored arguments again, and only then
executes. Removing, disabling, redirecting, recredentialing, or changing the
tool after review fails closed.

`input_required` is not success. It becomes a terminal failed proposal with the
remote server's bounded question relayed to the person. A remote success whose
audit or receipt cannot be persisted becomes terminal ambiguity with no retry.

## Native turn and workspace fence

The native bridge spans:

- `src/lib/ai/native-client.ts`: browser-to-WK message protocol and bounded
  transcript
- `useNativeAssistant.ts`: owner gating, tool registration, active turn state,
  event handling, proofs, and job cleanup
- `native-turn-fence.ts`: pure owner/workspace/conversation matching helpers
- `mac/Sources/TextText/WebAppWindowController.swift`: WK message validation,
  App Server lifecycle, tool forwarding, event tagging, cancellation
- `mac/Sources/TextTextWorkspaceCore/CodexAppServerProtocol.swift`: JSON-RPC
  requests, thread mapping, history restore, and inherited MCP disabling

Native tools and status are registered only after `ownerScopeReady`. Every
non-status Swift event must carry a conversation id. The active
`NativeTurnFence` records:

- initiating workspace handle
- opaque owner store key
- durable conversation id
- original runtime thread key

An event is accepted only when all four still match the active refs. An
untagged event, a late event from another conversation, or an event after
navigation is ignored. A stale tool call receives an error result rather than
executing against the new view.

Tool execution checks the same fence before the async command and again after
it returns. This prevents late proof or result handling from crossing the
workspace boundary. Scope change sends `assistantCancel`, marks the original
job as stopped, clears native refs and busy state, and rejects a pending utility
turn.

There is also a pre-start fence. Prompt preparation awaits attachment parsing,
context reads, and owner instructions before the native turn exists. A
render-current `currentOwnerScopeRef` is compared to the captured owner scope
immediately before installing the native fence and starting the turn. Without
this check, navigation during prompt preparation could create an orphaned turn
after cleanup had already run.

Swift validates that WK messages come from the main frame and expected origin.
Every emitted turn event is tagged with the active conversation id. Inherited
MCP servers in the owner's Codex profile are disabled for embedded TextText
threads. Local MCP execution remains refused until it can share the durable
review surface.

## Provenance and receipts

Artifact proof is deliberately smaller than chat explanation.

- Found: an item appeared in an access-checked recent index or search result.
- Read: exact item content was supplied through an exact read or explicit
  TextText context attachment.
- Changed: a validated canonical command receipt identifies the affected item.

Search snippets do not upgrade Found to Read. The model naming an item does not
create proof. A locally requested approval does not create proof if the server
returns a durable denial. A queued local mutation is not shown as completed.

Relevant code:

- `src/components/workspace/assistant/artifact-proof.ts`
- `src/lib/ai/cloud-client.ts`
- `src/app/api/ai/route.ts`
- `src/components/workspace/assistant/useNativeAssistant.ts`

## Attachments

`attachments.ts` decides what can enter a cloud or native turn.

Cloud supports bounded text and structured text, PDF, images, DOCX, XLSX, and
PPTX. Native can additionally use native OCR where available. Local file
attachments are not persisted as TextText content merely because they entered a
turn.

Important limits:

- extracted text context: 7,000 characters per ordinary attachment
- cloud text file: 1 MB
- cloud image part: 700 KB
- Office archive input: 5 MB
- Office archive entries: 256
- Office expanded total: 8 MB
- one Office entry: 4 MB
- Office extracted output: 120,000 characters before the turn-level bound

`office-attachment-text.ts` rejects unsafe paths, macros, excessive compression,
unsupported archive shapes, and oversized entries. It extracts paragraphs and
tables from Word, cells and formulas from Excel, and slides plus speaker notes
from PowerPoint. Unsupported binaries fail with a recovery message; they are
not silently treated as empty text.

When adding a format, update the accept list, the cloud and native builders, the
provider part mapping, size limits, product copy, and malicious-file tests
together.

## Settings and connection inventory

Workspace Settings is the source of truth for what TextText itself is connected
to. It inventories:

- the workspace Anthropic or OpenAI key, provider, and model
- the standalone native Codex connection when that edition is present
- hosted machine-client and MCP bearer tokens, with revoke controls
- outbound MCP servers, enabled state, tools, exact `@mcp` shortcut, and remove
  control
- account sign-in methods

Disconnect is capability-specific. Removing a provider key does not sign the
person out of another app. Disconnecting native Codex stops TextText using that
embedded runtime. Revoking a hosted token invalidates that external client.
Removing an outbound connection prevents future proposal approval because the
destination can no longer be re-resolved.

## Edition matrix

| Capability | Web | Developer ID Mac | Store/TestFlight Mac |
| --- | --- | --- | --- |
| Cloud Anthropic/OpenAI rail | Yes | Yes | Yes |
| Owner instructions, skills, history, proposals | Yes | Yes | Yes |
| Hosted `/api/mcp` | Yes | Yes | Yes |
| Outbound public HTTPS MCP | Yes | Yes | Yes |
| Embedded native Codex runtime | No | Yes | No |
| Bundled signed-in `texttext` CLI | No | Yes | No |
| Local MCP bridge | No | Disabled | Compiled out |
| Sparkle updater | No | Yes | Compiled out |

`TEXTTEXT_STORE=1` selects Store Swift settings. Store builds must continue to
compile without the Codex runtime locator, bundled CLI, local MCP execution,
Sparkle, updater/appcast code, or broad filesystem entitlement. Ordinary App
Sandbox network, user-selected file, app-group, and Keychain capabilities are
not workarounds; they are the supported platform path.

## File ownership map

| Concern | Canonical files |
| --- | --- |
| Tool names, schemas, mutability, confirmations | `src/lib/ai/tools.ts` |
| Browser workspace executor | `src/lib/ai/agent-tools.ts`, `workspace-tool-client.ts`, `/api/ai/tools` |
| Cloud route and grounding | `src/app/api/ai/route.ts`, `cloud-client.ts`, `cloud-tools.ts`, `system-prompt.ts` |
| Provider catalog and encrypted key | `provider-catalog.ts`, `provider-model.server.ts`, `workspace-ai-config.server.ts` |
| Owner instructions and skills | `agent-instructions.ts`, `workspace-agent-instructions.server.ts`, editor actions, `AgentInstructionsSettings.tsx` |
| Conversation replica | `conversation-store.ts`, `assistant-conversation-sync.ts`, `assistant-conversation-history.server.ts`, editor actions |
| Proposal policy and state | `write-proposal-policy.ts`, `write-proposals.server.ts`, `assistant-proposal-decisions.server.ts`, `/api/ai/proposals/[id]` |
| Outbound MCP | `outbound-tools.ts`, `outbound-proposals.server.ts`, `outbound-executor.server.ts`, `mcp/outbound*.ts` |
| Native bridge | `native-client.ts`, `native-turn.ts`, `native-turn-fence.ts`, `useNativeAssistant.ts`, Swift files named above |
| Attachments | `attachments.ts`, `office-attachment-text.ts`, `native-ocr.ts` |
| Provenance | `artifact-proof.ts`, cloud response cleanup, assistant conversation UI |
| Settings inventory | `WorkspaceSettings.tsx`, `McpConnections.tsx`, provider/token/sign-in action files |
| Durable schema | `src/lib/db/schema.ts` plus the three 2026-08-24 migrations |

## Safe change recipes

### Add or change a model

1. Update `provider-catalog.ts`; never accept arbitrary ids from the browser.
2. Confirm `provider-model.server.ts` maps the id to the provider SDK.
3. Update provider validation and Settings labels if needed.
4. Add exact-selection, Auto-routing, fallback, and receipt tests.
5. Exercise a real Keychain-backed turn before claiming support.

### Add or change a workspace tool

1. Change the canonical registry in `tools.ts` first.
2. Implement the canonical command below the adapter layer.
3. Decide mutability, confirmation class, and `openWorldHint` deliberately.
4. Update both server and browser/native adapters.
5. If cloud-proposable, add validation, preview, replay, ambiguity, and receipt
   tests. Never broaden `isProposableWorkspaceWrite` by name alone.
6. Regenerate or synchronize tool documentation.

### Change conversation persistence

1. Preserve stable conversation and message ids.
2. Update local migration, payload sanitizer, deterministic merge, database
   bounds, and server action together.
3. Test two-device concurrent edits, equal clocks, future clocks, secret
   scrubbing, oversized payloads, proposal terminal states, and reload.
4. Test fresh native thread history restore and mapped-thread non-duplication.

### Change proposal behavior

1. Keep browser decisions to opaque id plus approve or deny.
2. Bind every query and transition by proposal id, workspace id, and actor id.
3. Claim once before executing.
4. Revalidate the database copy after claim.
5. Preserve authoritative terminal replay across devices.
6. Preserve terminal ambiguity after a side effect with missing audit or
   receipt. Never translate it into a retryable error.

### Change outbound MCP

1. Keep exact `@mcp:<slug>` invocation; do not restore natural-language name
   matching or automatic discovery.
2. Keep remote text fenced and namespaced.
3. Keep every remote call proposal-only regardless of annotations.
4. Freeze and revalidate both destination and complete tool definition.
5. Test hostile descriptions, changed URL/token/schema, slug collision,
   `input_required`, audit failure after result, and cleanup.

### Change native integration

1. Update browser and Swift protocol ends together.
2. Keep registration and status owner-gated.
3. Tag every non-status event with conversation id.
4. Preserve the four-part `NativeTurnFence` and the pre-start owner-scope
   recheck after asynchronous prompt preparation.
5. Recheck the fence before and after tool execution.
6. Run both standalone and `TEXTTEXT_STORE=1` Swift suites.

## Failure modes already found and fixed

These are regression warnings backed by past audit findings, not hypothetical
style preferences.

- Localhost was treated as the primary integration even though distributed App
  Store apps cannot depend on a loopback companion. The primary local path is
  now the signed-in CLI; Store paths are HTTPS and sandbox-compatible.
- A signed-in collaborator could once reach privileged assistant behavior by
  supplying a handle directly. Every privileged route now checks the exact
  owned workspace.
- Assistant UI state was once visible before owner scope resolved. Status,
  history, jobs, tools, selection actions, and native state now fail closed.
- Native events were once accepted without an exact active conversation and
  could cross workspace navigation. The owner/workspace/conversation fence and
  pre-start scope token close both the late-event and prompt-preparation races.
- Native relaunch once lost conversational memory. A fresh ephemeral thread now
  receives bounded durable history exactly once.
- A stale device decision once collapsed to a generic conflict. Proposal replay
  now returns the authoritative completion receipt or denial.
- A successful side effect followed by receipt failure once looked retryable.
  It is now terminally ambiguous.
- A local Approve click could once create false workspace proof after another
  device had denied the proposal. Proof now requires an approved workspace
  receipt from the server.
- Outbound MCP discovery once matched natural-language connection names, so
  ordinary prose could cause network access. Only the Settings-displayed exact
  shortcut now authorizes discovery.
- A connection id alone once left room for endpoint or credential redirection.
  Approval now revalidates the protected destination fingerprint and frozen
  tool definition.
- Search snippets were once described too loosely as read context. Found and
  Read are now separate evidence levels.

Do not remove a guard because a nearby UI control appears to make it redundant.
Most of these failures existed precisely because presentation was mistaken for
authorization.

## Verification

Run focused tests while editing, then the full applicable set before push.

```bash
npx tsc --noEmit
npm test
npm run lint
npm run build
npm run verify:agent-integrations
scripts/run-release-migrations.sh --check
npm run eval:mcp:outbound
npm run mac:test
TEXTTEXT_STORE=1 swift test --package-path mac
mac/scripts/apple-plan-eval.sh --skip-tests
git diff --check
```

The outbound evaluator creates a temporary connection and removes it during
cleanup. A failed run must be inspected for leftover fixtures before retrying.
The production Next build currently emits a known duplicate-Yjs warning from
separate route chunks; it is non-blocking only while the build and collaboration
gates remain green.

For a real provider development check, keep the key in the login Keychain and
run `./scripts/dev-with-ai.sh` as described in `AGENTS.md`. Never place the key
in `.env.local`, a command argument, a log, a prompt, or this document. The mock
provider is for deterministic tests, not proof that the real provider works.

Do not run a release, deployment, installation, TestFlight build, upload, or
release record as part of source verification unless the owner explicitly asks.

## Deliberate gaps

The implemented assistant is not the entire Pen, Paper, or Notion category.
The current product still lacks:

- a first-party OAuth connector gallery and indexed Slack, Drive, Jira, GitHub,
  mail, and calendar search
- embeddings, a semantic workspace index, cross-service ranking, and
  answer-level inline citations
- generic archive handling, audio/video transcription, cloud PDF OCR,
  spreadsheet computation, and a code sandbox
- team, page-backed, automatic, or agent-authored skills
- model-readable screenshot or rendered-document verification
- a bundled headless model runner and export-verification batch loop
- multi-step Plan mode
- scheduled or event-triggered background agents

Persistent jobs additionally require an explicit owner decision under the
repository contract. Do not describe these gaps as implemented, and do not
silently expand the app into them during an unrelated task.

## Documentation maintenance

When behavior changes, update the smallest canonical set in the same commit:

- this runbook for implementation and trust-boundary changes
- `ai-sidebar-architecture.md` for system-level capability changes
- `agentic-text-product.md` when the product claim or parity ledger changes
- `/docs/ai`, `/docs/mcp`, `/docs/security`, or `/docs/troubleshooting` when the
  owner-facing behavior changes
- `HANDOFF.md` with the observed verification facts for the finished pass

Do not copy a transient test count into multiple documents. Keep the latest
counts and observed real-provider proof in `HANDOFF.md`; keep this runbook about
the durable system and the commands that verify it.
