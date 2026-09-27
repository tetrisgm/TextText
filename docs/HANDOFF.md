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

### Native limitation and remaining work

- A read-only `list_folders` request in the Store-shaped app proved general
  native workspace tools fail. The first test bundle omitted the runtime's
  sibling `codex-code-mode-host`. The isolated builder now bundles and signs
  it, and `CodexEmbeddedRuntime` requires both signed helpers. Retest in
  `/tmp/texttext-agent-test.xXWqLc/TextText Agent Test.app` advanced to a
  different failure: `code-mode host closed its stdout`. The macOS crash
  report `~/Library/Logs/DiagnosticReports/codex-code-mode-host-2026-09-27-163735.ips`
  shows V8 `FatalOOM` in `IsolateGroup::EnsureCodeRange` inside the sandbox.
  The direct terminal App Server session had called the same read-only tool.
  Do not claim general native tools work. Keep the sandbox permissions intact
  until the runtime failure has a reviewed fix. The document-look workflow
  currently uses locally validated blueprint data before the ordinary save.
- An isolated Mac save briefly showed client error boundary `err-0wudla6`
  after a successful apply. Navigating Home and reopening the document worked,
  and authoritative readback confirmed the save. Diagnose whether this is a
  transient dev refresh or a reproducible post-save UI issue before release.
- Native blueprint correction, focused tests, and the production web build
  passed in `b42be0e5`. The helper-packaging change passed an isolated app
  build, signature verification, shell syntax check, and five focused native
  tests; the live tool call still fails as described above. The full agent
  specification remains open. Nothing here has been shipped.

The local Next dev server was on port 3000 with
`/tmp/texttext-agent-dev-20260927.log`. The latest isolated test app was
`/tmp/texttext-agent-test.xXWqLc/TextText Agent Test.app`, bundle
`app.texttext.agenttest`, with the signed bundled Codex CLI 0.153.4 and signed
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
