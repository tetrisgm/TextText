# TextText handoff

## Current work: integrated agent customization

Source on `main` in `~/dev/TextText`: Home/capture/folder baseline `d6137d75`,
native runtime repair `3da87963`, web agent journey repair `35802110`.
The work repairs the in-app connection → selected document preview → refinement
→ save journey. It is not released or installed over the owner's application.

User request: September 25 attachment
`4a0448e5-8029-44e8-8e3c-21378eec0824/Pasted text.txt`. The user authorized
terminal work and subagents, but asked to limit RAM after repeated ChatGPT app
crashes. Run at most one compiler/build and one local web server. Keep tool
output bounded. This is task progress, not a change to the agent contract.

### Verified so far

- The baseline local refinement used saved Anthropic `claude-sonnet-5` and
  failed generation with upstream HTTP 401 `authentication_error`. There was
  no developer provider override. Template generation/save never started.
- The real same-provider terminal journey passed all 20 checks: protected
  setup, both exact prompts, actual renderer, ordinary create/apply actions,
  authoritative save/readback, unchanged content and metadata, lost-response
  reconciliation, stale revision conflict, and a fresh authenticated HTTP
  session. The existing fixture is saved at revision `491827`, look
  `look-fa4c0003fb6494beec338220c2e202a8@1`. Its rejected configuration was
  backed up as ciphertext and replaced through the normal setup action with
  the existing TextText-owned Anthropic key. No override or provider change.
  See the workflow receipt for correlation IDs and exact provenance.
- Source now checks real generation, classifies safe errors with request IDs,
  retains target-scoped customization drafts, uses shared connection choice,
  supports cancellation, checks document revision, and reads back saves.
- Native source can select a declared signed bundled Codex helper in the Store
  sandbox, with app-owned auth and documented device-code sign-in. Store builds
  without that bundle still advertise it unavailable. No release packaging
  change silently includes a runtime.
- Store compilation, 26 focused Codex tests, provider tests, studio tests,
  save/conflict tests and a full web production build passed. Combined focused web tests passed **262/262** across 25 files with one worker.
  Do not equate these with the live workflow.
- In the isolated Mac app, local TextText login and the actual selected document
  opened; Customize preserved the exact prompt and offered in-place ChatGPT
  setup. It has now reached device authorization, awaiting the user's sign-in.
  Authenticated native generation and native UI save remain unverified.

The live native app reached device authorization. The owner found the waiting
state unclear; the sidebar and compact setup now offer an explicit **Open
ChatGPT to sign in** link with numbered code/return instructions. Account
authorization and the native editing loop remain pending.

### Resume next

1. Complete fresh ChatGPT device authorization in the isolated sandbox app,
   then verify actual preview tool, save, reopen and account persistence.
2. Finish bounded recovery tests and update the verification receipt; commit
   coherent passing changes and push. Do not release, deploy, submit, replace
   the installed app, or change billing.

One local server may run on port 3000, with log
`/tmp/texttext-agent-repro-20260925.log`. The final web build log is
`/tmp/texttext-agent-build.log`. Do not dump provider logs wholesale.
The completed terminal journey's redacted receipt is
`/tmp/texttext-live-agent-provider-receipt.json`; its harness is
`scripts/verify-agent-provider-terminal.ts`. It is real HTTP/action/renderer
verification, not proof of native gestures or account-backed Codex execution.

Isolated native test bundle:
`/tmp/texttext-agent-test.Upt2ax/TextText Agent Test.app`. It has its own
`app.texttext.agenttest` container, bundled Codex 0.153.4, signed local-origin
environment, and File Provider effects disabled. Its native source digest is
`ffa14357c48f72c60d5081c43854b52da84f77529b61067993c102d0cc41d173`.
Old temporary bundles are obsolete; do not launch them. No helper credentials
were copied from another application. See the
[sandbox receipt](agent-runtime-sandbox-verification-2026-09-25.md) and
[workflow receipt](agent-experience-verification-2026-09-25.md).

### Deployment and unrelated open work

Installed app remains `/Applications/TextText.app`, Store-capability development
build 1.0 (1094). It uses `https://texttext.app` and contains no bundled Codex.
Its exact source SHA is not attested. Last recorded public web deployment is
`texttext-oracle-20260925T093930Z-95f0ba86`. Current source changes are local only.

Keep unrelated edits in `src/components/workspace/assistant/attachments.ts`,
`src/lib/workspace/__tests__/tabs.test.ts`, and `scripts/.probe-editor.ts` intact
and out of this commit. Public tenant DNS/TLS, missing Google replacement
secret, and the missing original private project-changelog document remain
separate issues. Do not create a duplicate changelog. No changelog entry is
needed for this unreleased work yet.

Resolved migration/sign-in history and prior references are in
[September 25 history](HANDOFF-history-2026-09-25.md). The broader product plan
remains [personal workspace](plans/personal-workspace.md); its performance and
unrelated capture work are outside this agent task.
