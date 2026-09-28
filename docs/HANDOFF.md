# TextText handoff

## Current work: integrated agent customization

Source: `main` in `~/dev/TextText`. The owner asked for the full in-app
connection → selected-document preview → refinement → save → reopen journey in
the September 25 attachment
`4a0448e5-8029-44e8-8e3c-21378eec0824/Pasted text.txt`.
Keep memory use bounded: one compiler/build at a time, one local web server,
bounded tool output. Do not deploy, release, reinstall, replace the installed
app, submit to the App Store, or change billing without a new owner request.

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
  pool fixes. Recheck disconnected first-use on this final source, bounded
  correction, and the remaining recovery matrix before declaring the full
  spec complete. Nothing here has been shipped.

The local Next dev server was on port 3000 with
`/tmp/texttext-agent-dev-20260927.log`. The latest isolated test app was
`/tmp/texttext-agent-test.IhNlCN/TextText Agent Test.app`, bundle
`app.texttext.agenttest`, with the signed bundled Codex CLI 0.153.4 and no
code-mode host in its own container. Temporary bundles must never replace
`/Applications/TextText.app`.

Preserve unrelated edits in
`src/components/workspace/assistant/attachments.ts`,
`src/lib/workspace/__tests__/tabs.test.ts`, and `scripts/.probe-editor.ts`.
No project changelog entry until a release is actually shipped.

## References

- [Native sandbox receipt](agent-runtime-sandbox-verification-2026-09-25.md)
- [Agent workflow receipt](agent-experience-verification-2026-09-25.md)
- [AI sidebar architecture](ai-sidebar-architecture.md)
- [Resolved September 25 history](HANDOFF-history-2026-09-25.md)
