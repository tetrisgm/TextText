# In-app agent customization verification

Status: real API-key generation, refinement, save and readback passed through
the local HTTP/action path and actual renderer. Native account authorization
and the complete native UI workflow remain unproved. This receipt distinguishes
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
  preview-only tool turn, correlation, cancellation, bounded schema correction.
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
start/cancel works. Fresh interactive authorization, actual model/tool work,
and persisted authenticated session still require live verification.

The isolated full app opened the selected local test document through real
Mac gestures, retained the requested research-reader prompt, and presented
in-place ChatGPT setup. Repeated host ChatGPT crashes interrupted the remaining
interaction. The app process sample did not show a blocked main thread or high
memory footprint, so those interruptions are not attributed to TextText.

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
`/tmp/texttext-live-agent-provider-receipt.json`. This proves an actual
provider-produced saved result, while ordinary UI save, native app reopen,
and account-session persistence still require the native verification below.
No additional paid checks were run during harness review.
The final read-only stored-renderer review confirmed the saved revision,
narrow notes node, original excerpt and commentary text, and separate source
links in the Markdown and excerpt. TypeScript passed after the harness was
added (`/tmp/texttext-agent-harness-tsc.log`).

### Remaining native verification

The isolated sandbox app has reached the documented device authorization step.
Fresh user authorization is pending. After it completes, verify the actual
preview tool, refinement, ordinary UI save, app reopen and continued account
session. A terminal API-key success does not complete that account-based goal.

No release, deployment, installation replacement, App Store submission, new
billing service, credential copying, or provider substitution was performed.
