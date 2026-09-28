# In-app agent customization verification

Status: real API-key generation, refinement, save and readback passed through
the local HTTP/action path and actual renderer. The isolated Mac app also
completed account-backed generation, refinement, save, and reopen for the
selected document. A September 27 isolated build also verified native
workspace read and write tools through the same account connection.
This receipt distinguishes
source, sandbox probe, provider calls, UI actions, and saved results.

## Baseline and failure

Source base `d6137d752a714b4f02676378428f0816ba7779e5`; frontend/backend
`http://localhost:3000`, local Postgres fixture `@visual-demo`. The existing
selected test document is `44d13a24-03d4-4fbe-8b32-cd2df1cf2acd`.

A real user-facing refinement reached `/api/ai/item-type` through the saved
Anthropic API configuration, model `claude-sonnet-5`. The matching server SDK
error was HTTP 401, `authentication_error`. The encrypted key existed and
could be read, but was rejected for generation. The baseline did not log a
provider request ID or carry a TextText correlation ID. No native runner,
blueprint validation, or template save handled that failed request. The UI
incorrectly treated stored configuration as proof of a usable connection.

A later explicit small generation check with the existing TextText-owned
Anthropic Keychain credential, same model, succeeded. No developer override or
provider substitution was used for that check. No credentials, raw provider
bodies, or authentication URLs/codes are retained in this receipt.

## Current source paths

- `ItemTypeStudio` / `ItemTypeAgentSetup`: preserved prompt, target, template
  base, scope, draft history; compact setup; shared selected connection; cancel.
- `useNativeAssistant` / native bridge: owner/workspace/conversation fences,
  private read-only design turn, correlation, cancellation, bounded schema
  correction. Native design data is validated before preview and ordinary save.
- `/api/ai` / `/api/ai/item-type`: same provider factory/configuration, scoped
  context, classified errors, signal propagation, generation-backed readiness.
- `item-type-actions` / `item-template-actions` / store: immutable template
  versions, ambiguous-save reconciliation, original document revision and
  authoritative readback; permission and audit preserved.
- Existing blueprint/compiler/renderer: bounded commentary-width option;
  Markdown and fields remain in the original schema-v1 document.

No continuous model health polling was added. External MCP/CLI access remains
separate from in-app authentication and is not proof of integrated editing.

## Native evidence

See [sandbox runtime verification](agent-runtime-sandbox-verification-2026-09-25.md).
Installed 1.0 (1094) has no bundled agent; it remains unchanged. The isolated
Store-compiled test app can launch the official bundled runtime in the sandbox.
Browser authorization fails on its local listener; documented device-code
start/cancel works. The account authorization completed and persisted across
app reopen. The screenshot with only a code showed the older UI; commit
`8f762c04` adds a visible ChatGPT button and numbered steps.

The isolated full app opened the selected local test document through real
Mac gestures and retained the requested research-reader prompt. Initial native
dynamic-tool attempts failed because the runtime selected its V8 code-mode
host. Bundling that host exposed a sandboxed V8 `FatalOOM` crash. A direct
tool namespace, configured both at launch and on each private thread, avoids
that host. Visible chats now start fresh threads after TextText registers its
workspace tools, rather than reusing the earlier connection-check thread.

The design turn now returns blueprint data without requesting a tool. TextText
parses, validates, quality checks, compiles, and renders that data locally
before save. In the Mac UI, both exact prompts produced actual previews. The
first native draft needed a second attempt to validate; source now includes a
bounded automatic correction turn, pending final live verification.

The ordinary UI save created look
`look-fa4c0003fb6494beec338220c2e202a8@2`. Applying it first hit a
document-revision conflict. The UI's **Read latest document and review**
action loaded current content, and **Done** applied the saved look. Local
store readback showed revision `492010` referencing that version. After an
app restart, the document body, commentary, source reference, selected look,
and ChatGPT account were present. A client error boundary appeared after
apply; the September 27 follow-up below identifies and fixes it.

## Checks and live result

The web production build passed (including TypeScript and static generation).
Focused Store tests passed 26 cases. The combined focused web suite passed
262 tests across 25 files, with one worker (25.98 seconds). It includes provider,
studio, cancellation/fence, field-preservation, revision and readback coverage.

### Real provider and save proof

On September 25, 18:15 PDT (September 26, 01:15 UTC),
`scripts/verify-agent-provider-terminal.ts` passed all 20 checks against the
existing local fixture. It used one terminal process, authenticated dev-login,
the real `/api/ai/item-type` route, ordinary Next server actions, and
`DocumentRenderer`. Source was the working patch on the baseline commit above.
Those implementation changes are now committed as native `3da87963` and web
`35802110`; no deployment or installed-app replacement followed.
This was not browser or native UI automation, and it does not prove the
account-backed Codex tool loop.

The encrypted local workspace configuration was backed up before replacing its
rejected credential with the existing TextText-owned Anthropic Keychain key.
`saveWorkspaceAiSettingsAction` accepted a real generation check and persisted
the key through the existing encrypted mechanism. Provider/model stayed
Anthropic `claude-sonnet-5`; no developer key/base-URL override, mocks, external
MCP, direct content write, or provider substitution was used.

| Step | Evidence |
| --- | --- |
| Exact research-reader request | HTTP 200, request `0da78d54-54c8-411c-a3cf-644da86fb15c`; real renderer showed the selected Markdown and commentary side by side |
| Exact narrower-commentary refinement | HTTP 200, request `3d37f945-78b0-4f4b-8940-06f081466345`; blueprint selected `commentaryWidth: narrow`, renderer retained the source link |
| Ordinary create/apply actions | Saved `look-fa4c0003fb6494beec338220c2e202a8@1`, document revision `491819` → `491827`; authoritative definition matched generation |
| Content preservation | Original and saved complete content hash `20d4eb4bd4c3f55ff35ff643bc51e0a0c77302fa2ca1e309cbb9b2a8351004c6`; Markdown, commentary and excerpt values were unchanged |
| Metadata preservation | Type, visibility, status, slug, folder, tags, starred/pinned state, file representation, creation timestamp and date matched before/after |
| Ambiguous response recovery | Reusing save request `c2f55750-dc23-4813-8b2a-14a4d3c46f2a` recovered the same template; repeated apply left the document revision unchanged |
| Stale write | Applying another look with original revision `491819` returned conflict and preserved the saved look |
| Fresh session | New authenticated HTTP session reopened the saved result and retained the verified same-provider connection without another generation check |

The local redacted machine receipt is
`/tmp/texttext-live-agent-provider-receipt.json`. This proves the
API-key provider path; the isolated native UI result is recorded above.
No additional paid checks were run during harness review.
The final read-only stored-renderer review confirmed the saved revision,
narrow notes node, original excerpt and commentary text, and separate source
links in the Markdown and excerpt. TypeScript passed after the harness was
added (`/tmp/texttext-agent-harness-tsc.log`).

### Remaining native verification

The data-only look path is proved in the isolated UI. The subsequent direct
tool test below proves native workspace read and one write. Verify final
automatic correction and the remaining recovery matrix. Account and model
access were proved separately from tool readiness.

### September 27 native workspace tool proof

The isolated Store-shaped build at
`/tmp/texttext-agent-test.IhNlCN/TextText Agent Test.app` used bundled official
Codex CLI 0.153.4, the app-owned ChatGPT profile, local origin
`http://localhost:3000`, and local Postgres. It contained no code-mode host.
From a fresh in-app chat, `texttext.list_folders` returned the actual folders.
From the selected existing test note, `texttext.append_to_item` added the exact
sentence “Native workspace tool verification: direct tool path works.” The
assistant showed an append receipt, and local authoritative `posts` readback
found revision `492011`, the sentence, original commentary and source, private
visibility, and the same saved look at version 2. Closing and reopening the
app showed the updated note and the continued **Chat with Codex** connection.
No new document, external MCP, sandbox permission, or installed app changed.

This proves a real native read and one ordinary local write. It does not yet
prove every recovery case, or reproduce disconnected first use on this final
source.

### September 27 selected-document save and recovery

On the same isolated Mac app and local document, **Customize this document**
opened the saved Research reader look with the actual body, commentary and
source reference. An account-backed design request made the commentary width
Balanced in the rendered preview; no manual template substitution was used.
Done saved look@3, but applying it met a real stale-revision conflict after the
assistant's document append. **Read latest document and review** initially
showed latest content while retaining the pool's old revision, causing a
repeat conflict. The recovery loader now bypasses the locally dirty body cache
and reads the owner-scoped `/api/post/[id]/body` response directly.

With that fix, the same pending save retried at revision `492011` and applied
look@3 at revision `492012`. The UI then exposed a reproducible client error:
`Unknown built-in template look-fa4c0003fb6494beec338220c2e202a8@2`.
Subsequent saves at look@4 and look@5 reproduced the same old-version issue.
The open editor retained a dirty local post while the refreshed workspace
catalog held the new look. The pool reconciliation now accepts a newer
server-confirmed template reference without discarding unsaved local text and
retains referenced prior definitions during the transition.

A final ordinary UI save applied look@6 and returned straight to the editor,
without an error boundary. Local Postgres readback found revision `492015`,
look@6, unchanged Markdown including the native append, original commentary,
and private visibility. Home navigation and reopening showed the saved item.
Three focused web test files passed 21 tests; TypeScript passed. The earlier
native direct-tool patch passed 20 focused Swift tests and live read/write
checks. The latest source has not been released or installed.

No release, deployment, installation replacement, App Store submission, new
billing service, credential copying, or provider substitution was performed.
