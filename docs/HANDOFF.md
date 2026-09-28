# TextText handoff

## Current work: integrated agent customization

Source: `main` in `~/dev/TextText`. The owner asked for the full in-app
connection → selected-document preview → refinement → save → reopen journey in
the September 25 attachment
`4a0448e5-8029-44e8-8e3c-21378eec0824/Pasted text.txt`.
Keep memory use bounded: one compiler/build at a time, one local web server,
bounded tool output. The owner authorizes replacing and installing the Mac app
going forward; no repeat permission request is needed for local installs.
Do not deploy, release publicly, submit to the App Store, or change billing
without a separate owner request. The September 28 local replacement is
recorded below.

### Installed local WIP, September 28

- `/Applications/TextText.app` is now the development-signed Store-shaped
  **1.0 (1095)** build from current `main`, with the official Codex CLI 0.153.4
  bundled as a signed sandbox-inheriting helper. `mac/scripts/build-app.sh`
  supports this only with an explicit runtime path. The bundle points to
  `http://localhost:3000` via its local WIP override; it needs the local Next
  server and local Postgres to keep running. The normal public website was not
  deployed. The previous **1.0 (1094)** bundle is recoverable in Trash, and
  `/Applications` contains one TextText app.
- The new app passed bundle signature and arm64/extension checks, launched from
  `/Applications`, and signed into the existing local Mira Chen fixture through
  development login. The live app showed Home, documents, and the assistant.
  The workspace currently prefers its existing Claude API-key connection; the
  bundled native runtime has not been exercised in this canonical profile.
- The full release gate stopped at `web.unit`: 13 failures across six files
  with stale command, copy, and extracted-hook expectations. The local app has
  no release-gate attestation, so its content-blind health report marks those
  attestation checks failed. This was a manual recoverable local swap, not a
  release or a passing canonical installer run. Do not publish or claim release
  readiness until those tests and the exact-source attestation pass. See
  `/tmp/texttext-wip-release-gates.log` and local commits `9fbb77eb`,
  `8af17056`. The Next dev server is in the current Codex terminal session
  with log `/tmp/texttext-wip-app-server.log`.

### Verified

- The older screenshot's device code belongs at the linked ChatGPT
  authorization page. Source commit `8f762c04` makes that next step explicit.
  The isolated app's own profile now reports `Logged in using ChatGPT`; after
  reopening, its sidebar says **Chat with Codex** without another setup.
- The real API-key path passed both exact prompts, renderer, ordinary save,
  authoritative readback, stale-revision conflict, and new-session checks.
  See [workflow receipt](agent-experience-verification-2026-09-25.md).
- In the isolated Store-shaped Mac app, the exact research-reader request and
  narrower-commentary refinement both produced schema-validated, rendered
  native previews. The saved look is
  `look-fa4c0003fb6494beec338220c2e202a8@2`, applied to document
  `44d13a24-03d4-4fbe-8b32-cd2df1cf2acd` at revision `492010` in local
  Postgres. Reopening the app showed the look, Markdown, commentary, source
  reference, and persisted ChatGPT connection.
- The save initially encountered a stale document revision. The existing
  **Read latest document and review** action loaded the latest revision, then
  **Done** applied the already saved look. The authoritative store read
  confirmed the final template reference.
- The isolated Store-shaped build now makes real first-party workspace calls
  through the app-owned ChatGPT account. `texttext.list_folders` returned the
  local folders; `texttext.append_to_item` changed the selected test note.
  Authoritative local Postgres readback confirmed the exact append, original
  commentary/source, private visibility, and saved look. Reopening kept the
  edit and ChatGPT connection. See the workflow receipt.
- On the final source, an in-app request changed commentary width from Narrow
  to Balanced in the live selected-document preview. A concurrent-edit save
  conflict reproduced, the recovery button fetched the authoritative revision,
  and Done then applied the saved look. A subsequent ordinary UI save returned
  directly to the editor with no error boundary. Local Postgres readback at
  revision `492015` confirmed look@6, body, commentary, and private visibility;
  navigating Home and reopening showed the saved item.
- A second, clean-profile Store-shaped test app built from `6a7fd9b8` proved
  disconnected first use. From the selected note, Customize preserved the
  exact request, opened in-context ChatGPT setup, resumed automatically after
  device authorization, rendered a Balanced preview, then rendered an AI
  refinement back to Narrow. Done saved look@7 at revision `492016` without a
  client error. Reopening the app showed the document and **Chat with Codex**
  ready. See the workflow receipt; no device code or credential is recorded.

### Native limitation and remaining work

- Earlier native tool attempts failed through Codex's code-mode host. The
  bundled host crashed in V8 inside App Sandbox. Current source places the
  TextText tool namespace on Codex's direct tool surface, starts each visible
  chat after tool registration, and omits the V8 host from the isolated bundle.
  The sandbox permissions are unchanged. Exact root-cause probes and the live
  read/write result are in the workflow receipt. The document-look path still
  uses locally validated blueprint data before ordinary save.
- The post-save client error was reproducible: a dirty open editor retained an
  older custom look reference after the pool advanced to the new version.
  The pool merge now keeps unsaved local text and accepts the server-confirmed
  look, retaining referenced definitions across the transition. The isolated
  UI save and reopen passed after this fix.
- Native blueprint correction, focused tests, and the production web build
  passed in `b42be0e5`. The direct-tool patch passed 20 focused native tests,
  an isolated signed app build, and the live read/write/reopen path. Three
  focused web test files (21 tests) and TypeScript passed after conflict and
  pool fixes. A final recovery suite passed 81 web tests across 13 files and
  25 native tests. Invalid credential, model access, quota/rate limit, timeout,
  cancellation, owner fences, and ambiguous-save behavior are covered by
  focused tests; the earlier real provider attempt returned a classified 401.
  The bounded automatic correction branch was tested in source, while both
  final live requests validated on their first returned blueprint. No release,
  installed-app replacement, or App Store review has happened.

The local Next dev server was on port 3000 with
`/tmp/texttext-agent-dev-20260927.log`. The initial direct-tool test app was
`/tmp/texttext-agent-test.IhNlCN/TextText Agent Test.app`, bundle
`app.texttext.agenttest`, with the signed bundled Codex CLI 0.153.4 and no
code-mode host in its own container. Temporary bundles must never replace
`/Applications/TextText.app`.
The clean-profile proof used
`/tmp/texttext-agent-firstuse.jqjbtpil/TextText First Use Test.app`, bundle
`app.texttext.agenttest.firstuse`, copied from the isolated build at
`/tmp/texttext-agent-test.8Z9ZLA` with only test identity metadata changed
and the bundle re-signed. Both test bundles point only to local port 3000.

Preserve unrelated edits in
`src/components/workspace/assistant/attachments.ts`,
`src/lib/workspace/__tests__/tabs.test.ts`, and `scripts/.probe-editor.ts`.
No project changelog entry until a release is actually shipped.

## References

- [Native sandbox receipt](agent-runtime-sandbox-verification-2026-09-25.md)
- [Agent workflow receipt](agent-experience-verification-2026-09-25.md)
- [AI sidebar architecture](ai-sidebar-architecture.md)
- [Resolved September 25 history](HANDOFF-history-2026-09-25.md)
