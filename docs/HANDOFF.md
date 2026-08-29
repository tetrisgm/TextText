# TextText handoff

Read `AGENTS.md` first; it is the contract. This file is the durable working
state: the goal, the scorecard, and the facts that keep future sessions from
relearning. Keep this shape: short sections, bullets, newest decisions win.
Narratives live in `git log`.

## The goal (owner, 2026-08-14)

TextText is a proven agent canvas. An agent connected any way (CLI, hosted
MCP, in-app assistant) can do real document work on par with pen.dev and
paper.design's canvas manipulation and Notion AI's documented capabilities.
Done means each capability exercised against a running build by a real agent
connection and observed in the UI. Green tests do not count; observed
behavior does. Prior sessions' claims (especially Codex-era) are treated as
unverified until exercised. The Notion-look polish continues, but behavior
outranks look, and the owner's Notion screenshots set the bar, not the old
polish ledger.

## Current AI implementation handoff (2026-08-25)

- The current source boundary is `4118c930` (`Finish guarded agentic
  assistant`). Commit `cbf89e1c` adds the durable implementation runbook and
  links it from the architecture and product ledger. At the start of this
  handoff pass, local `main` was clean and matched `origin/main` at
  `cbf89e1c`.
- A new session should read `AGENTS.md`, then
  `docs/agentic-assistant-runbook.md`, then
  `docs/ai-sidebar-architecture.md`. The runbook is the maintenance map for
  data ownership, owner gates, cloud and native turn lifecycles, proposal
  states, outbound MCP approval, evidence semantics, edition differences,
  safe change recipes, verification, and deliberate gaps. This file records
  observed state; `docs/agentic-text-product.md` records the competitive
  promise and parity ledger.
- Six surfaces must not be conflated: the cloud in-app assistant, standalone
  native assistant, signed-in local `texttext` CLI, inbound hosted MCP,
  outbound MCP used by the cloud assistant, and the private native item-type
  utility turn. They use different credentials and execution boundaries. The
  web app does not call its own MCP endpoint. Local agents do not require File
  Provider or a localhost bridge.
- The guarded implementation is complete in source: exact owner and workspace
  checks, durable bounded chat history, instructions and explicit skills,
  truthful model receipts, structured attachments, Found versus Read proof,
  durable cloud write proposals, terminal ambiguity after an unreceipted side
  effect, exact-shortcut outbound MCP with destination and tool fingerprints,
  native owner/workspace/conversation fencing, and a Settings inventory with
  disconnect and revoke controls. The detailed implementation facts and file
  owners are in the runbook rather than duplicated here.
- Running-build proof used a real Keychain-backed Anthropic connection. It
  covered a streamed answer, grounded Found and Read evidence, an inert
  create-note proposal, reload persistence, and a follow-up using durable
  context. The live outbound MCP evaluation covered discovery, proposal-only
  execution, approval receipts, hostile remote descriptions,
  `input_required`, and fixture cleanup. The final implementation gate passed
  182 web test files with 1,260 tests, a 45-page production build, 526
  standalone Swift tests, 525 Store Swift tests, the 48-point Apple matrix,
  TypeScript, lint, 30 migrations, agent integration verification, and the
  outbound MCP evaluation. The documentation pass reran all 1,260 web tests.
- “Everything is done” is not an accurate product claim. The deliberate gaps
  remain the connector gallery and indexed external services, semantic
  workspace retrieval and answer-level citations, broader media and document
  computation, team or page-backed skills, rendered-output inspection,
  unattended export verification, Plan mode, and custom background agents.
  They are inventory, not an authorized roadmap; the owner has not selected
  the next one to implement. The full current list is in the runbook.
- The 2026-08-25 handoff gate exposed a date-coupled conversation merge test:
  its remote message used a fixed August 24 timestamp, so the assertion changed
  behavior when the real clock crossed that date. The fixture now derives a
  timestamp one second after its generated local message. The focused 10-test
  file and the full 182-file, 1,260-test web suite pass after the correction;
  runtime merge behavior did not change.
- TestFlight work, App Store Connect changes, release records, deployments,
  installations, and public release actions remain deferred. The owner also
  deferred hands-on Touch ID and Google sign-in testing. No such action was
  performed by the guarded assistant or documentation passes. Store builds
  use supported App Sandbox and HTTPS paths and compile out local process and
  local MCP machinery; the primary AI architecture does not depend on the
  optional Finder File Provider integration described in older diagnostic
  notes below.

## AI runtime observed proof correction (2026-08-23)

- The earlier parity pass was not complete when it was first reported. Its
  tests were green, but the required running-build observation had not happened.
  The first real hosted turn exposed an empty reply that the UI mislabeled as
  `Done`, and the first reload exposed a persisted-job hydration mismatch.
- The deterministic Anthropic-shaped provider now implements the provider's
  streaming protocol instead of returning a non-streaming response to
  `streamText`. A provider stream error is terminal and can no longer be
  followed by an empty successful completion. The route also overrides the AI
  SDK's raw-error logger so provider error objects do not enter server logs.
- Assistant job SSR uses a stable empty snapshot, then restores bounded client
  history after hydration. Interrupted or failed jobs retain truthful activity
  instead of a permanent `Thinking` label or a hydration error.
- Observed in the signed-in `/@visual-demo` workspace against the running app:
  a hosted reply streamed useful text; a deliberately slow run exposed Stop and
  stopped with a failed receipt; a reload recovered the interrupted job; a
  provider failure remained a failure with no fake answer; Save to Notes created
  a private note and returned its Open receipt; thumbs-up persisted as pressed;
  a fresh tab hydrated with restored jobs and no console error.
- Repeated through `scripts/dev-with-ai.sh` with the real Anthropic key loaded
  from the login Keychain. Claude Sonnet 5 streamed `REAL STREAM OK` in about
  1.4 seconds, then completed a separate read-only workspace-tool turn in about
  3.2 seconds and correctly reported the synthetic demo's seven items. Neither
  turn logged a browser error or exposed the key.
- This proves the corrected runtime loop, not competitive completeness. Current
  gaps versus the referenced products remain searchable durable chat history,
  editable agent instructions and reusable skills, automatic or per-turn model
  choice, semantic retrieval with citations across connected sources, richer
  file analysis, and a uniform approval/review surface for freeform writes.
  No release or store action occurred.
- After the observed proof, TypeScript, targeted lint, 1,088 web tests across
  162 files, 522 Swift tests, the production build, and the live outbound-MCP
  evaluator all pass. The evaluator proves a real streamed assistant turn can
  call an allowed remote tool, resist a hostile tool description, preserve an
  `input_required` result, and remove its temporary connection afterward.

## Connection management pass (2026-08-23)

- Settings now opens with a Connections overview linking to the configured
  provider, native Codex state, client capabilities, outbound MCP servers, and
  sign-in methods. Client-token loading no longer depends on the destructive
  account-summary endpoint, so collaborators and valid signed-in states do not
  lose their connection list.
- `api_tokens.kind` records whether a capability is hosted MCP, TextText app,
  CLI, native, manual, or other. Existing rows backfill to `manual`; new app
  and hosted MCP capabilities are labeled at creation and can be revoked from
  Settings without exposing their secret.
- The standalone native Codex bridge now exposes Disconnect. It stops the
  embedded TextText runtime and clears its session state, while explicitly not
  claiming to sign the person out of Codex in another application.
- Configured browser and Store AI connections accept bounded local text and
  Markdown attachments. Images remain on the standalone native OCR path.
- Verification after this pass: 1,076 web tests, 522 Swift tests, TypeScript,
  lint, the production web build, migration coverage, and the agent integration
  verifier all pass. The build retains the known duplicate-Yjs warnings.

## AI runtime parity pass (2026-08-23)

- The in-app assistant now uses one streamed turn contract for hosted AI and
  native Codex. Hosted turns emit newline-delimited start, text, tool progress,
  completion, and error events over HTTPS. The sidebar renders live text and
  tool activity, and Stop aborts the request without requiring a local server.
- Assistant jobs persist in bounded local storage. A reload or app close marks
  an interrupted run as failed with a truthful explanation instead of leaving
  a permanently running spinner. Quick actions use the same job history and
  streamed progress as freeform turns.
- A completed answer can be saved to Notes with a server-authoritative receipt
  and idempotency key. Answers expose thumbs-up and thumbs-down feedback that
  records only bounded metadata in `action_audit`, never the answer body. The
  receipt shows the provider and selected model so a person can understand what
  produced it.
- Configured hosted providers accept bounded text, Markdown, and image
  attachments over HTTPS. Image data is validated at the route boundary and
  passed to vision-capable models as image parts; native OCR remains available
  for the standalone app. No localhost or loopback service is required.
- The shipped interaction contract is documented in
  `docs/ai-sidebar-architecture.md` and `/docs/ai`. Remaining deliberate
  boundaries are OAuth/PKCE connector onboarding (ruled unnecessary by the
  owner), server-side scheduled automations, semantic long-term memory, and a
  full proposal/approval surface for arbitrary freeform cloud mutations.
- Verification after this pass: 1,087 web tests across 162 files, 522 Swift
  tests, TypeScript, targeted lint, and the production web build all pass. The
  build retains four known non-blocking duplicate-Yjs warnings. No TestFlight,
  App Store Connect, release-record, or update-channel action occurred.

## Agentic text inbox loop (2026-08-20)

- The product loop is now explicit: capture instantly, retrieve from any
  authorized AI, make a visible guarded change, then verify or recover. The
  competitive contract and Pen/Paper inventory live in
  `docs/agentic-text-product.md`.
- Library capture accepts a thought, note, link, or AI answer without leaving
  the current view. Text routes to Notes and URLs route to Bookmarks through
  the shared `create_item` command. A durable six-item queue keeps the raw
  input and stable idempotency key before clearing the composer. Reload,
  rapid capture, Retry, View, Copy, Discard, confirmed Undo, and queue-full
  recovery are covered.
- Browser, standalone Mac quick capture, signed-in `texttext capture`, Claude
  and Codex plugin skills, and hosted MCP use the same routing semantics. A
  successful capture returns an authoritative receipt with the exact title,
  destination, item id, and Open action. Browser capture also keeps a
  server-confirmed Undo beside each of the six durable receipts. Native Quick
  Capture persists the same six-receipt history per workspace, offers exact
  Open, and performs a revision-guarded, server-confirmed Undo only after the
  authenticated credential still resolves to that receipt's workspace. A
  failure or account switch preserves the receipt. The UI never predicts
  success from model prose or requested arguments.
- Retrieval uses one normalized ranked token matcher in Library, MCP, and the
  local CLI. `texttext search` returns exact ids, snippets, hashes, and folder
  paths; `texttext read <id>` resolves the exact item. Read-only credentials
  can search and read, while mutation commands still require full scope.
- Assistant receipts are derived only from validated command results. Added
  TextText context is capped at four items, resolved canonically inside the
  authenticated workspace, and included in `Read` proof only when that item
  was actually loaded for the turn. Client-supplied titles and bodies are not
  trusted. Native writes report Updated only after acknowledgement, known
  authorization and stale-write failures roll back, whole-document replacement
  requires a hash, and targeted text or section edits keep their narrower
  guards. Completed receipts survive a later provider error instead of being
  replaced by a false total failure.
- Recent-work summaries use an access-scoped, newest-first SQL query capped at
  12 items. Selection quick actions are server-enforced read-only until Apply,
  and user content is fenced as untrusted context so text inside a note cannot
  grant the assistant write access.
- External-agent folder, template, asset, capture-status, comment, restore,
  publish, and document mutations now write their attributed audit atomically
  with the mutation. Failed storage or audit work cannot leave an unaudited
  content change behind.
- Visual proof covers Library capture, six simultaneous receipts, assistant
  safe areas, and failed-capture recovery at 1440, 768, and 375 pixels in both
  themes. The same matrix proves pinned navigation and assistant rails, exact
  search and Open, source-linked summaries, guarded Apply and Undo, and failed
  provider recovery. A disposable native app proves Return and Shift-Return,
  URL routing, recovery Copy and Retry, confirmation-gated Discard, exact Open,
  light and dark appearance, and the guarded Undo confirmation. The native
  bridge proof uses a disposable local item and exercises zero-tool summary,
  exact read, guarded live edit, AI audit, Apply, and Undo.
- The final settled-tree gate passed TypeScript, lint with zero errors, 1,073
  web tests across 160 files, 522 Swift tests, both agent integration
  verifiers, the official plugin validator, all five skill validators, the
  full native browser bridge, standalone app and CLI source builds, the Store
  source build and entitlement scan, and the 44-page production web build.
  The Store binary has no Sparkle link; the standalone release build retains
  Sparkle 2.9.5. The web build retains four known non-blocking duplicate-Yjs
  warnings at serialized route boundaries.
- The current real native Codex rerun is blocked before product execution by
  the signed-in ChatGPT account's usage limit until August 26 at 8:31 PM. It
  made zero dynamic tool calls. Prior real native Codex proof remains valid for
  the unchanged App Server isolation path, while the current native bridge
  rerun proves the final browser prompt, read, guarded edit, AI audit, proposal,
  Apply, and Undo path. Do not call the quota-blocked rerun green.
- One saved-workspace visual session reached `/api/ai` but returned 502 before
  generation. A separate request through the documented Keychain-backed
  `dev-with-ai` path selected Anthropic Claude Sonnet 5 and returned 200 in
  about 1.2 seconds with zero tools, proving the route, SDK, and catalog model
  against a real provider. The earlier failure is isolated to that saved
  workspace/runtime state or a transient provider failure. The UI states that
  no change occurred and offers Retry and Verify connection. Do not present
  deterministic-provider screenshots as evidence of a live Anthropic response.
- This is source work only. No app was installed, no deployment or promotion
  ran, and no TestFlight, App Store Connect, release-record, or update-channel
  action occurred. The installed and public app remain unchanged until the
  owner deliberately promotes a later commit.

## Capability scorecard

- [x] Create with substance: agent-created note with body, right folder,
  idempotent replay on the same key. Observed 2026-08-14.
- [x] Complete rewrite under observation: agent replaced an open document's
  entire body; the change appeared live with the agent's presence chip and
  its named cursor at the end of its own text. Observed 2026-08-14.
- [x] Transform: note became a Broadsheet article via set_item_template,
  retitled with excerpt and tags via update_item; rendered look verified in
  the open browser. Observed 2026-08-14.
- [x] Workspace operations: search matches titles and body text;
  append_to_item replayed=true on a same-key retry with exactly one block in
  the body, which is the changelog pattern. Observed 2026-08-14.
- [x] Rules under agency: every agent mutation has an action_audit row typed
  external_agent; a real foreign-workspace item id reads back as not-in-this-
  workspace (fails closed, no existence oracle); comments land attributed to
  the agent. Observed 2026-08-14.
- Both agent papercuts are fixed (2026-08-15) and verified live:
  set_item_template takes template_version optionally and defaults to the
  look's current version, and append_to_item takes `markdown` like its
  siblings while still accepting the original `markdown_fragment`.
- How to run the loop: mint a token (POST /api/link/start, approve in a
  signed-in browser, poll), then drive `/api/mcp` per the transport contract
  in scratchpad agent.py: `_meta` trio in the body plus MCP-Protocol-Version,
  Mcp-Method, and Mcp-Name headers. 33 tools.

## The spec and the removal pass (2026-08-14)

- `docs/SPEC.md` is the owner-ratified constitution: five pillars plus an
  explicit out-of-scope list. Code no pillar justifies gets removed.
- The REMOVE bucket is done, five commits, ~5,900 lines: legacy TipTap
  editor cluster (14 deps), legacy project-gallery reader and its CSS,
  App Store listing draft, merge-accounts and spent repair scripts, the
  entire guest/anonymous/claim machinery (plan tier, tokens, cookies, UI),
  and 27 dead exports. `blogs.edit_token_hash` drops via
  `scripts/migrate-drop-edit-token-hash.mjs` at next release.
- SUSPECT bucket ruled by the owner 2026-08-14: assistant skills, demo
  mode (the seed module and the store's demo branches), `bench/`, and both
  dated docs (deleted, not archived) are all gone.
- The one ruling not carried out as written: the collaboration verifiers
  were not duplicates. My audit read `verify-collaboration-live.ts` and
  `verify-live-collaboration.ts` as one check under two names. They are
  four layers (in-process merge on the release gate, database soak with an
  offline reconnect, two real browsers proving a human SEES a caret, and
  epoch fencing cited from `db/schema.ts`). Renamed to
  `verify-collaboration-{database,browsers,epoch}.ts` instead of deleted;
  all four are listed in `docs/document-types.md`. Say so if you still want
  them cut.
- Postgres is now required. A missing `DATABASE_URL` throws
  `TextText requires DATABASE_URL` from store.ts instead of quietly serving
  fixture content. `scripts/setup-local-db.sh` no longer seeds; the database
  starts empty and signing in provisions the workspace.
- Kept by ruling: the `project` "Media post" item type. It is the
  video-focused blog post (the shape ramine.net publishes), not a legacy
  gallery. Its reader is the DocumentRenderer gallery node.
## The two build pillars (2026-08-15)

- **Outbound MCP is built.** Workspace Settings has Connected MCP servers;
  TextText handshakes, lists tools, stores them, and the connection is saved
  OFF until the owner allows it. Remote tools are namespaced `slug__tool`,
  the URL is SSRF-checked before every connection, descriptions are capped
  and fenced, tokens are encrypted with `lib/secret-box.ts`. Proof:
  `npm run eval:mcp:outbound` drives Settings in Chromium against
  `scripts/mock-mcp-server.mjs` and reads the mock's own log to show the call
  arrived. The mock ships a deliberately hostile tool description; the run
  asserts from the receiving side that no document text was forwarded.
- **Template management is built.** The folder menu has Change look (the
  agent could do this and a person could not). Retiring a look exists for the
  first time, in the UI-facing store and as `retire_document_template`. Proof:
  `npm run eval:folder-look`, both themes.
- **`/docs/mcp` is the reference**, generated from the tool registry so it
  cannot drift: 33+ tools grouped by what they do, eight client setups with
  real commands, a verify step, the outbound direction, and the safety
  boundary. A test fails if a tool name is ever hardcoded there.

## Outbound MCP after the 2026-07-28 revision (2026-08-15)

- The revision retired `initialize`, replaced server-initiated requests with
  Multi Round-Trip Requests (`resultType: "input_required"`), and added
  `ttlMs`/`cacheScope` to list results. Our INBOUND server was already built
  to it: `server/discover` answers, every result carries `resultType`, and
  the cacheable lists carry hints. Verified live, not read off a comment.
- The outbound CLIENT was not, because I wrote it by learning our own
  server's errors rather than from the spec. Three defects, all fixed:
  `input_required` read as an empty success and returned "Done."; the
  retired `initialize` cost a round trip per connection per turn; cache
  hints were ignored so every message re-listed every server.
- OAuth was ruled unnecessary (owner, 2026-08-15). Local servers need no
  auth, and hosted ones mostly issue static tokens. The cost is a worse
  first five minutes and any OAuth-only server being unconnectable.
  Note that DCR is deprecated in favour of CIMD if this is ever revisited.
- Per-call approval was dropped: MRTR is the protocol's own mechanism, so
  bespoke approval UI would have been reinventing it worse.

## Historical local MCP exploration (superseded 2026-08-20)

- Paper, pen.dev, and Figma can expose loopback MCP endpoints tied to their
  desktop applications. That comparison informed the product, but TextText
  does not offer loopback endpoints in Workspace Settings in this release.
- TextText's local Claude and Codex integration is the signed-in `texttext`
  CLI in the standalone Mac edition. It does not start an MCP server, request
  a workspace token, or depend on File Provider.
- Outbound TextText MCP connections use public HTTPS addresses. Browser and
  Store editions cannot expose the capability-gated native loopback bridge,
  and public product copy must not advertise it as an available setup path.

## Templates simplified to A+B (owner, 2026-08-15)

- The authoring API is GONE: `customize_document_template`,
  `preview_document_template`, `presentation/operations.ts`, two test files
  and two eval scripts, plus most of the system prompt, which had become a
  manual for a vocabulary nobody could use. ~1,400 lines.
- Making a look is now: shape a document, then "Save as look" in its menu, or
  `save_item_as_look` for an agent. A look is a template plus the theme the
  document carries. `saveDocumentAsLook` in store.ts is the one implementation.
- Verified live: `npm run eval:save-as-look` drives the real menu in Chromium,
  names a look, checks the document did not change, and confirms the look is
  in the workspace's templates. The gallery's own rendering is proven by
  `npm run eval:folder-look`.
- Known rough edge: a look saved during a session shows up in the picker on
  the next load, because the gallery reads the pool fetched at page load.
- The catalogue is ten. Cutting it to nine left no look declaring
  `collection.layout: "timeline"`, so a blog could not read as a dated run at
  all once folder looks took over how an index renders. `texttext.timeline`
  restores it (owner ruling 2026-08-16): Article's document, field for field,
  with a timeline index. It sits after the original five, which stay first and
  byte-compatible. `single` was NOT restored, deliberately; `now` still exists
  and still resolves for documents pinned to it.
- `blog.cardStyle` is deleted (owner ruling 2026-08-16), column and all:
  `scripts/migrate-drop-card-style.mjs`. It chose whether published cards
  showed their cover, it was set from the same Blog popover the layout picker
  lived in, and it lost its only UI when that popover went. Card style is a
  property of how a folder index renders, and looks govern those now, so a
  second stored answer on the workspace row was the shape the ruling removed.
  A Covers toggle was built on Home first and deleted before it shipped:
  `WorkspacePostOption` renders no covers, so it would have been a control on
  Home that silently changed the published Blog page. Cards always show the
  cover they have.
- `npm run eval:home-layout` is the live proof, both themes. It needs
  `NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000` on the dev server, because the
  published Blog page is a workspace subdomain.

## The blank landing page, and why it was blank (fixed 2026-08-16)

A signed-out visitor at `/` saw white above the fold, in every browser and in
a production build. The DOM was correct, the layout was correct, the h1
reported opacity 1 and hit-tested as itself, and nothing painted, not even a
background colour set on it by hand.

The cause was one rule in the document engine:

    .tt-document:not(.tt-collection-item):not([data-preview])::before {
      content: ""; position: fixed; inset: 0; z-index: -1;
      background: var(--paper, #fff);
    }

A document that IS the page paints its paper across the window, which is
right for a reader. The landing page embeds a look demo further down, and that
demo threw the same fixed, full-window sheet over everything above it. The
sections after the demo painted because they come later in paint order; the
hero did not. A `position: fixed` div appended at runtime painted on top,
which is what made it look like a compositor fault rather than a stacking one.

The fix is the mechanism the engine already had: an embedded document passes
`preview`. Three of five call sites were not passing it. The rule now carries
the hazard in a comment, because the guard is opt-out and the set of places a
document can be embedded is open-ended.

`npm run sweep` now fails on a surface that comes back blank. It compares the
PNG byte length of a capture against a flat 8x8 of the same page: a surface
with text and rules compresses far worse than a rectangle. That check is the
only thing in this session that would have caught it, and cheap.

Two traps worth keeping:

- `IntersectionObserver({trackVisibility: true})` is not a paint oracle. It
  reported the heading invisible in states where the page painted, and a
  bisect built on it named an innocent rule with total confidence. Pixels, or
  nothing.
- Disabling one stylesheet at a time proves nothing here, because the engine
  CSS is injected by the renderer itself as well as by the page. Removing the
  page-level copy while the renderer kept emitting its own is why the CSS
  looked exonerated for an hour.

## Traps found while building these

- `position: fixed` does not escape an ancestor with `backdrop-filter`. The
  look gallery opened from the sidebar rendered inside a 260px column with
  its card names cut to three letters. Portal to `document.body`.
- A dead-export sweep removed `textTextChangeSequence` from `db/schema.ts`.
  Nothing imported it, and drizzle-kit builds its model from that module's
  exports, so the next `drizzle-kit push` tried to DROP the sequence that
  `posts.revision` defaults from. Schema declarations are load-bearing
  without importers.
- Never truncate a JSON body before parsing it. The outbound client capped
  the raw reply, which turned a large but legitimate `tools/list` into a
  parse error rather than protecting anything.
- A controlled checkbox bound to server state ignores the click for a whole
  round trip and reads as broken. Keep an optimistic override until the
  server answers.

## Historical implementation notes (superseded as backlog)

These observations are retained because they still explain old failure modes.
They are not the current priority order. The scorecard above is now fully
checked, real-provider proof occurred in later passes, and current product gaps
live in `docs/agentic-assistant-runbook.md`. File Provider notes in this section
describe the optional Finder representation; they are not requirements for the
in-app assistant, local CLI, or hosted MCP.

- The scorecard that was once unfinished is now fully checked.
- Fixed observation hazards: verify `window.innerWidth` is nonzero before
  trusting any browser measurement (a restarted pane can be 0x0 and serves
  stale compositor frames to screenshots).
- The in-app assistant lane is exercisable without a real key:
  `node scripts/mock-ai-provider.mjs` plus
  `TEXTTEXT_AI_BASE_URL=http://localhost:3999/v1 npm run dev`, then save any
  fake key in workspace settings. Exercised 2026-08-14: greeting, root and
  item-named starters, quick actions, chat round trip with provider
  attribution, and the Rewrite proposal cycle (preview, apply, undo) all
  observed live. This remains the deterministic development path; later
  sections record the separate real-provider proof.
- Feature docs (`/docs/features`) grow only with exercised behavior, and
  `npm run eval:features` now enforces that: it drives the claims the page
  makes and names the ones it cannot drive. It caught /connect still promising
  OAuth after the removal. Add a check when you add a claim.
- `npm run sweep` photographs every surface, both themes, for a design pass.
  It asserts nothing on purpose. It is what found the landing page.
- Installed-app auth verification (sign out, auth sheet round trip) still
  pending.
- Mac round trip 2026-08-16. The app builds, installs, launches, renders
  correctly in BOTH themes, is signed in, opens Home on List (the new
  default), and talks to the dev server. Screenshots taken unattended.
- Screen Recording was NEVER the blocker; the 2026-08-15 note claiming it was
  is wrong. `screencapture -l <window>` returns a window's own backing store,
  and a WKWebView renders its content out of process, so the web view is not
  in it: that is the black rectangle, on a machine with the permission
  granted. `-R` failed separately because the rect was taken from
  CGWindowList without checking it fits the display. Capture the whole screen
  with `screencapture -x` and read that. The display here is 1800x1169 points
  at 2x, so a full capture is 3600x2338.
- FIXED 2026-08-16: the Mac app never linked, and the cause was the state
  directory. `AppGroupContainer.choose` picked the first candidate that
  EXISTED. The team-prefixed group container survives on disk from an earlier
  install, so it existed, but a Developer ID build is not sandboxed and its
  entitlement names the bare group id, so every write into the team-prefixed
  path was denied. StateStore writes through `try?`, so the denial was silent:
  `saveCredentials` appeared to work, `loadCredentials` returned nil a
  millisecond later, the app never linked, and no File Provider domain was
  ever registered. The window looked healthy throughout because the web view
  carries its own session cookie.
- Existence is now not the test; writability is. `AppGroupContainer.isWritable`
  probes with a real file create, because POSIX permissions on that directory
  say yes and the sandbox still says no. When no candidate is writable the
  resolver returns nil and StateStore keeps state in Application Support,
  which is where the Developer ID build always kept it. Two regression tests
  cover it in StateStoreLocationTests.
- How it was found, for the next silent-failure hunt: an os_log at every branch
  of the link path, streamed live across a relaunch
  (`log stream --predicate 'subsystem == "app.texttext"' --info --debug`). The
  trace read "linked: credentials saved" and then "seed: NO CREDENTIALS" three
  lines later, which named the bug in one screen after a day of reading code
  that all looked correct. `log show` after the fact returned nothing for this
  process; only `log stream` during the run worked.
- Verified after the fix, with no override: credentials persist, the domain
  registers, and `~/Library/CloudStorage/TextText-TextText` exists.
- The mount then did not enumerate, and that turned out to be a SETTING, not
  a bug: `fileproviderctl dump app.texttext.mac.fileprovider` reports
  `domain: t{6}t ... (user-disabled)`. macOS has TextText's File Provider
  switched off, so the system never launches the extension, every
  NSFileCoordinator request fails with FP -2011, and `pkd` is never even asked.
  Nothing the app does can override it; it is the owner's toggle in
  System Settings > General > Login Items & Extensions > File Providers.
- Compare states when diagnosing this, they are distinct and the wording is
  the diagnosis: Synology reads "temporarily disconnected", Write reads
  "extension not found", TextText read "user-disabled".
- The app can read `NSFileProviderDomain.userEnabled` on macOS. The current
  SDK declares it available on macOS 11 and later, and the implementation is
  covered by the Mac build and health tests. A linked domain that the user
  disabled reports a runtime warning but does not invalidate an otherwise
  healthy release build. A missing, enabled-but-unusable, or broken domain
  still fails health. The app does not toggle the setting on the user's behalf.
- App Store record 1.0 vs shipped 0.175: submission-time only.

## Workflow and dev loop

- Work on `main` in `~/dev/TextText` (contract of 2026-08-12; no worktrees,
  no merge-gate). A stale pre-commit hook still demands merge-gate; commit
  with `OWNER_OVERRIDE=1`. The hook is a persistent job, not ours to remove.
- Dev loop: use `npm run try`. It starts the local server, opens an isolated Mac
  app against it, and tears both down. `mac/scripts/install-local.sh` replaces
  the owner's canonical `/Applications/TextText.app`; it is a promotion tool,
  not a development preview command.
- Dev builds (http origin) are Safari-inspectable and append one layout line
  per load to `$(getconf DARWIN_USER_TEMP_DIR)/texttext-layout.log`. Trust the
  probe over screenshots; computer-use screenshots downscale and lie about
  geometry.
- The Mac webview ignores synthetic automation clicks (hover works, real
  clicks work); drive the same UI in a browser at localhost instead.
- `window.__ttDraftDebug` (dev only) reads the selection draft store; every
  writer in that store fails silent by design.
- HMR resets module-level state (the draft store empties); reload the page
  before concluding anything after editing `workspace-item-draft.ts`.
- Verification tools: `npm run eval:collaboration:browser` drives two people
  and an agent through 24 checks; the release gate runs live workspace
  proofs. Local Postgres only; production Neon never leaves release lanes.
- Releases, deploys, uploads: owner-ask only. TestFlight build numbers burn
  on upload; next is 183+.

## Design: the Notion polish loop

- Loop discipline: name the loudest deltas, fix, screenshot light and dark at
  1400, commit, repeat.
- Rounds landed 2026-08-14:
  - `d90650df` rail state machine is binary; overlay state and hover-peek
    deleted; pin button gone; saved "open" reads as docked.
  - `8aa78c43` centered 1000px content column; quiet search field; sidebar
    boundary is a color not a line; unboxed item icons and create box.
  - `249384da` bare-glyph history arrows and toggles; counts as facts;
    whispering section headings.
  - `4714b447` `--workspace-rail-inset`: the shell publishes how much right
    edge the docked rail owns; ALL fixed chrome adds it to its right offset.
    Any new fixed element must add the inset or it will sit on the rail.
  - `a3065460` + `27666973` connect CTAs as per-path rows (see AI rail).
- Starters and connect rows are soft filled cards (Notion), not hairline
  outlines; scrollbars thin and trackless; toolbar controls surface on hover.
- DESIGN.md rules bind: both themes always, sentence case, no em dashes,
  taste over decoration.

## Assistant and AI rail

- One layout mechanism: pinned = real grid column via `has-assistant-pinned`;
  hidden = module overlay off-canvas, clipped (`overflow: clip` on the
  overlay root; a translated hidden panel otherwise adds one panel-width of
  horizontal scroll to every page).
- Sizing the rail with `!important` is banned; three stacked mechanisms once
  reserved 600px for a 240px rail.
- Connect state lists every path from `AGENT_INTEGRATIONS`: Claude/Codex copy
  one install command, ChatGPT links to its apps page, MCP copies
  `https://texttext.app/api/mcp`, API key is the quiet line. Copy must run
  `execCommand` synchronously inside the click's activation, then fall back
  to the async API; the reverse order spends the activation and goes mute.
- The hosted MCP URL and sibling strings are lowercase on purpose; a
  mixed-case copy of the origin already broke Mac sign-in once
  (case-sensitive host comparison).
- Starters render only with a provider connected; they name the open item,
  clip titles at 48 chars, and map Trash/Shared to their own sets.
- `assistantAgentIdentity()` is the one derivation of which AI is present
  (native connection wins, else cloud provider); it feeds the rail header,
  the bottom-right avatar launcher, and document presence. The inline copies
  it replaced had drifted (API-key AIs never appeared on documents).
- Agent presence is real Yjs awareness for MCP agents and the in-app
  assistant alike (`runWorkspaceToolForSession` -> `agentPresence`,
  actorType "ai", connection name "Assistant").
- The selection pipeline: the editor registers the open item's draft and
  mirrors every selection into `workspace-item-draft` (its "subtitle" maps to
  the store's "excerpt"). The selection toolbar reads that store, never
  `window.getSelection()` (blind to textareas), and refreshes on a 60ms
  settle after mouseup/keyup/selectionchange. It once shipped fully dead with
  a green suite: the store had no writer.
- A running turn reports itself in one place: inline, under the message that
  started it (`.working`, a pulsing dot and the progress line). The jobs strip
  above the conversation lists only work the person cannot see, filtered by
  `jobsForOtherThreads`; the launcher's count still covers every job in the
  workspace. Listing the current thread's turn at the top announced it in the
  one place the person was not looking (owner report, 2026-08-26).
- The transcript follows its own end while the person is within 32px of it,
  driven by a `ResizeObserver` on the thread and a scroll listener that
  releases the pin the moment they scroll up. It used to scroll only when a
  message was added, so a streamed answer grew past the bottom edge and took
  the working line off screen about two seconds in. `npm run eval:turn-progress`
  fails on the old behavior with "in in out out out".
- A cloud write is a PROPOSAL: the model stages exact arguments, the person
  approves them with Apply change, and only then does the executor run. Three
  things had to be true for that to work and none of them were, until
  2026-08-26. `npm run eval:assistant-create` drives the whole flow for a note,
  a bookmark, an article, and a described item type (folder, then
  create_item_type, then an entry in it) and watches each land.
- Which turns carry write tools is a trust boundary, not a convenience: item
  text reaches the model fenced as untrusted data, and a turn asked only to
  summarize must not hold a tool an injected instruction could reach. The
  gate reads the person's own message. It is a LEXICON, so it has near misses,
  and "Give the reading log its own look" was one: the write surface vanished
  and the assistant answered with something agreeable. The list is wider now,
  `HAND_ME_BACK` keeps "give me a summary" read-only, and `readOnlyTurnNote`
  makes the remaining misses speak instead of failing silently.
- The assistant conversation sync is a bounded, redacted COPY, never the
  authority for what is on screen. Its cleaner refuses to store a write
  proposal it could not reproduce exactly, which is right for a copy, and its
  depth bound of 8 could not reach the leaves of a `create_item_type`
  blueprint (nine levels down). Merging that copy back took the approval card
  off the screen about a second after it appeared while the change sat pending
  on the server. Depth is 16, and `keepLocalWriteProposals` puts back what the
  copy could not carry.
- A write that cannot even be STAGED now reports the reason as a failed
  workspace call. Before, a proposal rejected at validation left no card and
  no error, only the model's prose.
- `/docs/features` documents only exercised behavior, by rule stated on the
  page. `/docs` indexes it.

- The native turn deadline measures SILENCE, not work. It was an absolute
  30s clock started at `turn/start` and never extended, so a real Codex turn
  over a long prompt was interrupted mid-answer and the person was told the
  agent took too long while it was still typing (owner report, 2026-08-26).
  `WebAppWindowController.codexTurnProgress(method:)` names the events that
  restart the clock; the per-tool deadline is a separate 8s and unchanged.

## Measuring the AI look suite (2026-08-27)

- Nine briefs now, not five. The original five covered prose, plain notes,
  pages, tasks and links. The four added reach primitives none of them touched:
  checklist and facts (recipe-cards), gallery (photo-journal), heatmap over
  dates (habit-tracker), rows and quotes (reading-notes). A primitive the suite
  never asks for is a primitive nobody finds out is broken.
- `docs/sidebar-looks-baseline.json` is a COMMITTED baseline of the shape of
  each answer: whether a look was applied, what the index and item show, and
  which fields are inline vs buried. Measured from the RENDERED page, never
  from the blueprint JSON. Drift is reported per brief; accepting it is a
  deliberate `--update-baseline`.
- It deliberately tracks only what should hold still. The model is not
  deterministic, so fonts, sizes and colours differ every run and comparing
  them would cry wolf every time. It still does not score: it says what
  changed, and the screenshots are still judged by eye.
- FIRST FINDING, unfixed: `habit-tracker` applies a look and produces NO fields
  at all (`inline: [], buried: []`) with an index that errors
  "no collection item on the page", though the brief asks for a date, a
  distance and a day grid. `todo-list` gets Completed and Priority inline but
  not the due date. That is the model's design quality, not the engine, and it
  is now visible instead of invisible.

## texttext new: the hang was a symptom, the silence was the bug (2026-08-27)

- Reported as "hangs three minutes and creates nothing". It does not hang on
  its own: every case reproduces clean now, including a duplicate title (the
  CLI already de-duplicates the FILENAME as `Title [uuid].textpack`).
- The hang was the broken deployment. `create` writes into the File Provider
  root and `replaceItemAt` on that volume blocks until the extension commits,
  and the extension was waiting on a workspace returning 500s
  (`column api_tokens.kind does not exist`). Fixing the migration fixed it.
- The filesystem call cannot be interrupted, so the fix is to stop it being
  SILENT: `announcingSlowWork` in the CLI prints, after 8s, what it is waiting
  on and why that can take minutes. It wraps `withActor`, which every mutating
  command goes through, so new/write/append/edit/capture all get it.
- `DocumentStore.create` had NO test. It has five now: round-trip, folder
  honoured, missing folder refused, same filename refused rather than
  overwritten, and no temporary debris left behind.

## npm run evals (2026-08-27)

- One command runs every browser eval and reports THREE states: passed, failed,
  and could-not-run. The third is the point. Nothing ran these before: eighteen
  scripts, six in the release gate, every browser one outside it, so
  `eval:item-type` was dead long enough that a session called its failure
  environmental and `eval:sidebar` was being killed by every deploy. Both looked
  exactly like "nobody has run this yet".
- A missing precondition is never a pass and never a failure. It is named, with
  the command that fixes it, and only real failures set the exit code, so the
  runner is trustworthy on a machine that is not fully set up.
- Preconditions checked up front: dev server on :3000, mock provider on :3999,
  a local `.next` build, the codex CLI, and a LOCAL DATABASE_URL.
- `npm run evals -- --list` prints the matrix without running anything;
  `npm run evals -- turn` runs the subset whose name matches.
- 12 passed, 0 failed, 0 blocked as of this date.

## The page can tell when it is out of date (2026-08-27)

- A Mac window keeps the bundle it loaded, so a deploy never reaches an app
  that is already open. A fix shipped at 12:33, the deployed artifact contained
  it, and a window open since before that showed the old behaviour at 14:15.
  The owner reported a fixed bug as broken and was right to: nothing on screen
  could have told them.
- `next.config.ts` now inlines the same build id into the client (`env:
  NEXT_PUBLIC_BUILD_ID`) and `/api/app/build` returns it. Both come from the
  build, not the runtime environment, so the endpoint answers for whichever
  deployment handled the request. `compareBuild` in `src/lib/deployed-build.ts`
  holds the decision, away from React and the network, with its own tests.
- `UpdatedBuildNotice` checks on focus and visibility (when a person returns to
  an app they left open) and otherwise every ten minutes. It NEVER reloads by
  itself: a reload mid-sentence would throw away unsaved writing, and being
  out of date is not urgent enough to take that risk for someone.
- It stays silent when the id is "development", where `next dev` reports the
  same value forever while the code changes on every save, and silent when the
  endpoint is unreachable. Saying nothing beats nagging.

## capabilities is gone (owner ruling, 2026-08-27)

- A look used to declare which product features its items supported: assets,
  capture, collaboration, comments, import, publish, responses, search. It was
  declared on all eleven built-ins, derived for every AI-generated type, and
  read by NOTHING. The only code that touched it checked the array for
  duplicates. It sat exactly where "what editing does this item type support"
  belongs, so a future session would have assumed it worked.
- Deleted, with `migrate-drop-template-capabilities.mjs` stripping the key from
  stored definitions. That migration is not optional: `templateDefinitionSchema`
  is strict, so a stored look still carrying the key fails to parse once the
  field is gone. It stripped 211 looks from a local dev database; production had
  no stored looks at all.
- `blueprint.audience` ("private" | "publishable") went the same way, and the
  argument for keeping it did not survive being checked. It was defended here as
  telling the model what it was designing. It had no `.describe()` (unlike
  `styleReference` directly above it), no mention in any prompt, no UI, and no
  reader. Its one real job had been deriving the `publish` capability, which the
  bullet above deleted. Removed from the schema, the three starters, the JSON
  shape in `ITEM_TYPE_BLUEPRINT_FORMAT`, the mock provider, and six test
  fixtures.
- No migration was needed, and the difference from capabilities is worth
  keeping straight: a blueprint is a transient INPUT that compiles to a
  `TemplateDefinition` and is then discarded. Nothing stores one, so no stored
  row can carry a stale key. `itemTypeBlueprintSchema` stays `.strict()`; a
  model that emits `audience` from habit gets a repair round-trip
  (`itemTypeBlueprintRepairPrompt`, wired at `api/ai/item-type/route.ts`), which
  is what makes strictness safe here.
- The live question this leaves open: when the AI invents a type and no folder
  is named, nothing about the type itself informs where it lands. Placement
  comes from folder mode alone. `audience` looked like it answered that and
  never did.
- What publishable actually means is still enforced, by folder mode at the
  intent layer ("publishing refuses notes and bookmarks at the intent layer").

## Driven in the real app, not described (2026-08-27)

- Everything below was verified by typing the owner's own prompt into the
  installed Mac app through computer-use and reading the result out of the
  production database. The handoff note that the Mac webview "ignores synthetic
  automation clicks" is about JS-dispatched events; real OS-level clicks work,
  so the app IS drivable and a session should drive it rather than ask.
- Verified in-app: the working line appears for the whole turn ("Working with
  the TextText Agent"); a repeated title no longer collides
  (project-requirements-2, -3); the note body is byte-for-byte the pasted text
  (1341 bytes in, 1341 stored, every line verbatim); `##` markers are hidden in
  edit mode with list bullets kept; the sort reads "Recently opened"; and a
  receipt carries no Save-to-Notes or thumbs while a plain answer still does.
- The clipboard is shared with the person. A paste picked up a path they had
  copied seconds earlier and sent it as the prompt. Re-write the clipboard and
  VERIFY the composer contents before submitting; do not assume a write stuck.

## Two notes may share a title (2026-08-27)

- The slug comes from the title and `(folder_id, slug)` is unique among live
  rows, so asking for a second note called the same thing as the first threw a
  constraint violation that reached the person as "The item could not be saved.
  Try again." Trying again produced the same collision forever, and the owner
  hit it on the second run of their own prompt.
- `freeSlugInFolder` in `createDraftInFolder` picks the next free slug. Every
  create path goes through that function, so the rule is there and not in each
  caller that derives a slug. `eval:native-create` asks for the same note twice
  in one run; without the fix it fails with the exact 409 the owner saw.

## The Mac app keeps running the JS it started with (2026-08-27)

- A deploy does not reach an open app window. The WKWebView holds the bundle it
  loaded, so fixes land in production and the person keeps using the old code:
  the marker hiding shipped at 12:33 and an app open since before that still
  showed every `##` at 14:15. Verified the deployed artifact DID contain the
  rule, so this is staleness and not a missing deploy.
- There is no version-skew signal in the app: nothing compares the running
  build with the deployed one and nothing offers a reload. `NEXT_DEPLOYMENT_ID`
  exists for Server Action skew, which is a different problem and does not help
  an idle window. Quitting and reopening is the only cure today.
- This makes every "reload and try" instruction load-bearing, and it makes
  bug reports ambiguous: a report may describe code that is no longer live.

## What keeps the writing surface safe to change (2026-08-27)

- The surface styles markdown with FOUR HAND-ROLLED REGEXES (heading, quote,
  list, inline emphasis/code). The reader parses with remark + remark-gfm.
  These are two implementations and they WILL drift: the reader knows tables,
  strikethrough, footnotes and wiki links that the regexes do not. Do not treat
  that as a bug to chase construct by construct.
- The drift is cosmetic, and only cosmetic, while ONE property holds: the
  segments concatenate back to the input, character for character. Everything
  downstream is absolute offsets into that same string. `segmentsForValue` is
  exported for that invariant, and
  `markdown-surface-invariant.test.ts` pins it over a construct corpus (tables,
  strikethrough, wiki links, fences, footnotes, unicode, empty lines) plus 2000
  seeded-random strings, so a construct nobody has written yet is covered the
  day it appears. It also checks every segment's stamped line number, which is
  what `revealLine` matches against.
- An unstyled construct looks plain. A segmenter that drops one character moves
  every offset in the product while the document still looks right. The first
  is a cosmetic gap; the second is the failure mode worth a property test.

## eval:sidebar needs a LOCAL build, and it is the AI look suite (2026-08-27)

- It was dead, and not for its own reasons. It serves `.next` with
  `next start`, and it signs in through the dev sign-in, which is compiled away
  unless the build carried AUTH_DEV_LOGIN=1. `vercel build --prod` (i.e. every
  `npm run deploy:web`) leaves exactly such a build in `.next`, so deploying
  broke this eval with no other trace. Run `npm run build` first;
  `deploy-web.sh` now says so on the way out, and the eval refuses with the
  reason instead of waiting 30s for a form that is not coming.
- It also needs the `codex` (or `claude`) CLI on PATH as the model, and says
  which one is missing.
- This IS the "how good is the AI at generating document types" suite. Five
  briefs today: Medium blog, Apple Notes, Notion pages, Todoist to-dos,
  Raindrop bookmarks. It drives the real system prompt, the real tool set and
  the real executor, and deliberately does NOT score itself: it produces
  before/index/item/editor screenshots to be judged by eye against the
  reference the brief names. Scoring a look by asserting on its JSON is how an
  earlier version passed while producing pages nobody would ship.

## Markdown syntax shows on the line you are writing on (2026-08-27)

- The body was never a textarea. `MarkdownSurface` is a contenteditable that
  renders THE SOURCE, styled, in one `pre-wrap` element with inline spans and
  literal newlines, so `textContent` is exactly the source. That is why the
  fix is small: CodeMirror would have replaced an architecture that was
  already right.
- Markers are HIDDEN, never removed. `selectionOffsets` walks text nodes
  (`createTreeWalker(SHOW_TEXT)`), which CSS cannot move, so `Y.Text`,
  `textRange`, `bodySection` and `if_match_hash` are all untouched. Anything
  that starts REMOVING marker text moves every offset in the product while the
  document still looks right, which is the worst way for this to fail;
  `eval:markdown-surface` asserts the markers are still in the DOM.
- Only syntax the styling already speaks for hides (`tt-md-syntax`: headings,
  strong, em, code). List and quote markers stay: nothing else on the line says
  "list", so hiding `- ` turned a list into paragraphs. That was caught by
  looking at the screenshot, not by the assertions, which had all passed.
- Slots are named by kind now: `slots.prose` for markdown bindings,
  `slots.bindings` for plain. `case "prose"` falls back to `bindings`, so an
  older caller is unaffected. `richtext` fields use the same surface, minus
  peer carets, which they never had.
- `eval:sidebar` fails at DEV SIGN-IN and has nothing to do with this. It fails
  identically with `src/` stashed to the pre-change tree. Another silently dead
  eval, not yet chased.

## The person's text is the person's (2026-08-27)

- "Create a note about: <2,500 words pasted in>" came back as the agent's
  SUMMARY of that text, reorganized into sections and bullets, and the reply
  said so proudly. Neither prompt told it not to.
- `SUPPLIED_CONTENT_RULE` in `src/lib/ai/system-prompt.ts` is the one copy.
  The cloud system prompt and `nativeAssistantTurnPrompt` both include it, and
  `supplied-content-rule.test.ts` fails if either stops. Two prompts with two
  versions of a rule is the same shape as the placement bug: the copies drift
  and the worse one wins.
- STILL OPEN, and it is not a tweak: the editor shows raw markdown markers
  (`##`, `-`) because it is a transparent `<textarea>` over a styled `<pre>`
  mirror. The mirror must keep exact character alignment with the textarea
  under it, so it cannot hide characters without breaking the caret. Notion or
  Medium behavior needs a real rich-text editor (ProseMirror/Lexical/TipTap)
  with markdown input rules, not a change to the mirror.

## The native turn went quiet the moment it started (2026-08-27)

- `submit` sets the thread busy, then the native branch hands the turn to the
  bridge and RETURNS FROM INSIDE THE TRY. The finally then cleared the busy
  flag immediately, so the rail showed nothing at all for the whole turn: no
  working line, no dot, an empty panel while the agent worked. A native turn is
  settled by its own turn-completed and error handlers, so the finally now
  skips the clear when `handedToNativeAgent` is set.
- Only `submit` hands off this way. `runQuickAction` is cloud-only, and
  `generateItemTypeBlueprint` runs its own promise with its own busy handling.
- `eval:native-create` holds the fake turn open (NATIVE_TURN_DELAY_MS, default
  2500) and asserts the working line is on screen while the agent thinks. It
  fails with "nothing appeared under the message for the whole turn".
- Save-to-Notes and the thumbs belong on an ANSWER, not a receipt. A message
  carrying artifact proofs reports work the assistant DID; offering to save
  "Created the note X in Notes" into Notes is absurd, and rating a receipt is
  meaningless. Both are suppressed when `message.artifactProofs` is non-empty.
- The Library's "recent" sort keys on how recently you OPENED an item, with
  updatedAt only as a tiebreak, so a brand new item does not appear at the top.
  It said "Recently updated" while "Last edited" was the option that actually
  sorted by update time. Renamed to "Recently opened".

## One rule for where an unplaced item goes (2026-08-27)

- The contract says the UI, the in-app assistant and MCP call ONE
  workspace-command surface. For "where does an item with no folder go" that
  was not true: `agent-tools.ts` answered it client-side in
  `normalizeLegacyNativeArgs` before the request left the browser, so the
  executor's rule never ran on the native lane. Two copies of a rule is one
  rule and one bug in waiting, and that is exactly how it went: the same fix
  had to be made twice, and the client's worse answer was the one that shipped.
- The adapter no longer decides. It normalizes a folder the person NAMED (so
  "Notes" and "notes" agree) and passes `kind` through; `mcp/tools.ts` places
  it, and the adapter reports the destination from the executor's receipt.
- The good error moved with the rule. The client used to say "No folder at path
  bookmarks", which is clearer than falling through to blog and hitting the
  kind-versus-mode check, so the executor says it now instead.
- Test both lanes after touching this: `eval:native-create` and
  `eval:assistant-create`. They should agree by construction now, which is the
  point.

## The two lanes create items differently (2026-08-27)

- A CLOUD write is staged as a proposal the owner approves; a NATIVE (connected
  agent) tool call runs immediately through `createWorkspaceAgentTools`. They
  resolve a missing destination in SEPARATE code, so a routing fix in one
  proves nothing about the other. `eval:assistant-create` covers the cloud
  lane; `eval:native-create` covers the native one.
- Telling them apart from a screenshot: the native lane labels its answers
  "Answered by OpenAI" (hardcoded), and it stages no proposal, so an owner with
  zero rows in `ai_write_proposals` has never used the cloud lane. That is how
  the 2026-08-26 report was placed on the native lane after the fact.
- The native lane had the cloud lane's old receipt hole: a refused command was
  handed to the agent and nowhere else, so the rail showed only the model's
  retelling ("Saved that as a note." over a note that was never created) and
  the job still read Done. It now appends the command's own words to the
  transcript and the job says "Nothing changed".
- When neutering a client-side fix to prove an eval has teeth, WAIT for the dev
  server to rebuild. A six-second wait served a stale bundle and the eval
  passed against code that was no longer there, which reads exactly like a
  toothless test. Twenty seconds plus a request, then run.

## Two loops and a language, built (2026-08-28)

- `docs/render-spec.md` is the template language written down: 22 render nodes,
  8 collection layouts, 10 field types, 10 theme axes, the closed binding
  grammar. `render-spec-doc.test.ts` reads the vocabulary back out of the Zod
  schemas at runtime and checks both directions, so neither the page nor the
  schema can move alone. Verified it fails by deleting `poll` from the page.
- `eval:item-verbs` drives a real model with the person's own sentence and then
  reads the workspace back: add a section without disturbing the prose, retitle
  without touching the body, summarise three notes into a fourth, tag across
  items, refuse an item that does not exist. Assertions are on durable state,
  never on the model's summary.
- Two failures it found first were the harness, not the product. It cut tool
  results to 1500 characters where the product sends them whole, so list_items
  overflowed and ids fell off the end. And a stable per-task email reused the
  workspace, seeding a second copy of every note, so the model edited the older
  duplicate while the assertion read the newer: passing alone, failing in a
  batch. Check that shape before believing a model-driven eval.
- The agent harness moved to `scripts/eval-agent-harness.ts`, shared by the
  look suite and the verb suite.

## PostType is gone; there is one vocabulary (2026-08-28)

- `PostType` and `ItemKind` were the same five values with two spelled
  differently in storage: `project` was `media_post`, `talk` was `video_post`,
  and two converter functions existed only to translate between the pair.
- `scripts/migrate-post-type-to-item-kind.mjs` renames the two enum values.
  `ALTER TYPE ... RENAME VALUE` is atomic and touches no rows: values keep
  their identity, only the spelling changes. Locally that was one item each.
  It refuses rather than guesses if both spellings are somehow present.
- Run it BEFORE the deploy that removes PostType. A database renamed ahead of
  the code reads fine on the new code, and it is idempotent.
- `PostType` now has zero references. The two converters were identity
  functions once the values matched, and are deleted. `POST_TYPE_BY_VOCAB`
  still accepts both spellings when parsing a file, so a `.textpack` written
  before today still imports.
- 13 of 13 browser evals, 1,571 unit tests.

## Eval flakiness is machine load, not always code (2026-08-28)

- Three evals failed in one suite run, three different ones in the next, and
  every one of them passed alone. After killing the dev server, the mock and
  stray Playwright processes and starting fresh: 13 of 13.
- The signature is failures that MOVE between runs. A regression fails the same
  check every time. One of the intermediate failures was the model writing a
  Risks section without bullet points, which is model variance, not a defect.
- Before believing a suite result, check what else is running. Hours of
  Playwright browsers and model CLIs leave the machine unable to meet the
  timeouts these evals assume.

## An item goes where its type lives (2026-08-28)

- `create_item` chose its destination from `kind`, a closed list of five, and
  resolved `template_id` further down, AFTER the destination was already
  decided. So the thing an item actually is never influenced where it landed.
- That is the wrong shape for a product whose item types are designed by the
  assistant. Ask for a running log and a Runs type gets made on notes/running,
  and the next create still routes as if the only kinds were the built-in five.
- It now looks for the folder whose default look IS that type, and uses it. No
  table mapping kinds to folders is needed: the folder using a type is the
  folder that type was made for. The `kind` branch stays as the fallback for
  callers that pass no type, and is the next thing that can go.
- Same shape as the visibility change earlier today. Both were asking a closed
  five-value enum a question only the open world can answer, and in both cases
  the answer was already sitting on the folder.

## Visibility comes from the folder now (2026-08-28)

- Owner's design call: item kinds are created by the assistant, so the set is
  open and growing. A person should not be coerced into five fixed types. That
  makes a closed enum the wrong shape, and it takes the enum's last real job
  with it.
- `resolveDocumentVisibility` used to force private when the item's TYPE was
  note or bookmark, through a parameter the code itself named
  `compatibilityType`. It now asks the FOLDER. "Is a runs-9eef4c private?" has
  no answer once kinds are open; "is the folder it lives in private?" always
  does, and it is the question the person answered when they filed the thing.
- Fail closed at every step: no folder is private, no request is private, and a
  private folder overrides an explicit request to publish. Resolved AFTER the
  folder is loaded in savePost, because the folder is what decides it.
- ONE BEHAVIOUR CHANGED, deliberately and pinned by a test. A note moved into
  Blog can now be published. The old rule made it private forever because its
  type said note. This takes two explicit acts, moving and then publishing, and
  "notes stay unlisted" still holds: an item moved out of Notes is not in Notes.
  `setPostFolder` changes only folderId, so moving alone publishes nothing.
- `posts.type` is still stored and still drives folder placement for new items.
  Removing the column is the remaining step and needs a migration.

## A wedged dev server passed the precondition (2026-08-28)

- An eval run reported 12 of 13 failing, with symptoms pointing everywhere
  except the cause: sign-in forms that never appeared, "the page may be
  private", a look suite that demanded a rebuild. The dev server was returning
  404 for every route including /api/app/build.
- The `server` precondition used `reachable()`, which accepts any status under
  500, so a server that 404s everything reported `ok`. Now it requires a 200
  from /api/app/build. A precondition that cannot tell serving from dead is
  worse than none, because its "ok" is believed.
- I nearly attributed that run to the visibility change. Restarting the server
  on the same code gave 12 of 13 passing. Check the server before the diff.
- `eval:item-type` failed once afterwards on the people picker and then passed
  three consecutive runs at 21 of 21, and passes at HEAD too. Recorded as the
  known timing flake rather than a regression: the picker does not filter on
  visibility, and the resolved visibility is identical for every item whose
  folder and type agree, which is all of them.

## One concept, four names (2026-08-28)

Owner: if the code cannot be safely changed, simplify the design rather than
the tooling. Went looking for concepts that could be one thing.

"What kind of item is this" was spelled four ways:

- `PostType` = article | project | talk | note | bookmark (what is stored)
- `ItemKind` = article | media_post | video_post | note | bookmark (what is
  shown, and what the file's `kind:` frontmatter carries)
- `MarkdownItemKind`, a third name for the same five values
- `FolderMode` and the folder path, which both restate it again

Two of those are now gone. `ItemKind` also listed `feed_item` and `group_post`,
and the `Surface` type listed `feeds` and `group`, for surfaces that were never
built: each appeared exactly once, in its own declaration. With those removed
`ItemKind` and `MarkdownItemKind` are identical, so the second name went, and
`Surface` went with them. `folderPathForPostType` and `folderModeForPostType`
were the same mapping written out twice; both names stay because the intents
differ, a path to look up against versus a mode to branch on, but the mapping
exists once now.

STILL OPEN, and the real one: `PostType` and `ItemKind` are the SAME five
values with two of them renamed, `project` to `media_post` and `talk` to
`video_post`, and two converter functions exist solely to translate between
them. 261 occurrences. Collapsing them removes the concept, and it needs the
owner's word, because `type:` is a stored column and `kind:` is in the
frontmatter of every file on disk. That is a data migration, not a refactor.

## Two things verified against the database rather than by test (2026-08-29)

There is no database-backed test infrastructure here; store tests cover pure
functions. Both of these were checked by running against local Postgres, and
both are the kind of thing a unit test with a mocked store would have asserted
about the mock rather than about the behaviour.

**The revision guard on restyling.** A write carrying a stale revision matches
zero rows; the same write without the guard matches one. That second number is
what used to happen to a collaborator's words.

**Paging through a folder.** With a page size of 2 against a 34-item folder:
pass one changed 2 and reported 32 left, pass two changed 2 and reported 30.
Before the fix the second pass changed nothing, because the slice was taken
from all rows rather than from the ones still needing work, so every pass
looked at the same first page and skipped it as already done.

## The two goals, and what it took to move them (2026-08-29)

Plan in `docs/plans/two-goals.md`. Written, torn apart by gpt-5.6-sol at max
reasoning, rewritten, built, verified twice more, and repaired after each pass.

**What the reviews were worth.** The first found the sharpest gap against the
owner's own words - an agent on this Mac had five verbs, and the plan asserted
it had all of them - plus three fixes that were wrong rather than incomplete.
The second found real defects in all four commits that followed, including one
my own test had written down as correct. The third found that the widened
surface was unreachable from the actual `texttext` binary, so the capability
was claimed and not delivered.

Every one was verified in the code before being acted on. Most held. Three did
not survive contact with a later pass: the four-state distinction collapsed
again one layer out, retired looks stayed resurrectable through restore and
through the sync installer, and I claimed a backslash escape for `==highlight==`
was impossible after checking only the text node. The node's position still
spans the original source and the VFile still holds the backslash, so it was
not impossible; it works now. Verifying the narrow claim and generalising it
was the mistake, not the checking.

**Habits worth keeping.**

- Three test suites shipped this session could not fail. Two were the same
  mistake: the renderer inlines the stylesheet, so asserting on the whole SSR
  output matches the CSS rather than the element. Everything shipped afterwards
  was mutation-tested - break the guard, watch the test fail - and one that did
  not hold was found that way.
- Two claims in comments were invented rather than checked, and the second
  correction was also wrong. A comment described a backslash-escape mechanism
  for `==highlight==` that did not exist. Checking showed remark strips the
  escape before any plugin sees the TEXT NODE, and I concluded it was therefore
  impossible - which is false, because the node's position still spans the
  original source and the VFile still holds the backslash. It works now.
  Verifying the narrow claim and generalising from it was the error both times.
- An eval caught what no unit test could: `update_item_type` worked and no
  model could find it, because `list_document_templates` described itself as
  listing templates and answered with 24,000 characters of render trees. Ten
  tool calls and two failures became two calls and none.

**Where the goals stand.** A person can describe a kind of item, get it, and
change it afterwards by asking. `eval:item-verbs -- change-item-type` proves
the CHANGE half against a real model: the type is seeded directly by the task's
setup, and the model is given only the later "add somewhere to say how it felt"
request. It asserts fields and versions, not how the page looks. Creation from
a person's words is covered by the item-type evals; visual output is covered by
nothing that can fail. The assistant can
read, update, highlight, organise and act across items; eight eval tasks cover
it. It still cannot delete, publish or share from the browser or the local CLI,
because those need a confirmation flow that does not exist, and there is no
bounded batch command.

## eval:item-verbs, dated receipt (2026-08-29)

A review pointed out that "21 checks, passing" appeared in a plan with nothing
in the repository to support it, and that a green `npm run evals` can also mean
the relevant suites were blocked. So: run against a real model on 2026-08-29,
all seven tasks passed, every check.

    add-section  retitle  summarize-into-note  tag-several
    highlight  act-across-items  refuse-missing

Two of those are new, and they were written because the owner's own examples of
what the assistant is for were not covered anywhere.

`highlight` asks, in a person's words, for the most important sentence to be
highlighted, and says nothing about syntax. It passes now because `==like
this==` exists; before that the model bolded things, which means something
else. The model found the syntax from the tool description and marked one
sentence, leaving every other word identical.

`act-across-items` asks for a different closing line in each of three notes. It
passes on the agent lane and used eight tool calls to do three notes: list,
then read and append per note. The browser lane capped at eight steps, so the
same request was already at the ceiling with three notes; that ceiling is 24
now (`src/app/api/ai/route.ts:56`) and reaching it is reported rather than
passed off as a finished answer. A raised ceiling is not a batch command
though: `update_item` still updates one item (`tools.ts:721`), so "act on many"
is still N calls, and N is still bounded.

## What a max-effort review found after I called it finished (2026-08-29)

gpt-5.6-sol at `max` reasoning, 425k tokens, pointed at my own conclusion that
the simplification was done. Verdict: "You stopped exactly where the real
simplification begins." Three concrete bugs, all verified and fixed, plus one
architectural finding that reframes the whole effort.

**A malformed look destroyed the words.** The embedded template was validated
as part of the whole sync envelope, so an unreadable look threw in
`parseSyncDocumentEnvelope`, the PUT route caught it and returned 400, and the
document never reached the save. The comment at that route promised "a
malformed or unwelcome look must not fail the write: the person's words are
the thing being saved" and the code did the opposite. I wrote both. Fixed with
`.catch(undefined)` on the template so a bad look degrades to no look; four
tests, three of which fail without it.

**A note showed its metadata line twice.** `headerNode` emits one for every
shape that is not an article, and a second was pushed just before the header
for notes. No test counted nodes. Fixed, with a per-shape count pinned.

**`display: "section"` on a number, date, boolean or enum threw at compile
time** with "prose cannot consume number binding ...", naming a node the model
never wrote and cannot see. The schema accepted it, the compiler routed it to
prose, the render validator refused. Guarded like cover and toggle.

**The finding that matters most: the built-ins' distinctiveness is not in the
grammar, it is in CSS keyed to their ids.** `styles.ts` carries 166 rules
matching `data-template="texttext.*"` across the 11 built-in ids, and that
section is 54% of the file. An assistant-created type gets an id like
`runs-9eef4c`, which matches none of them. So an AI-designed look cannot reach
the visual quality of a built-in no matter how good the grammar becomes, and
no amount of primitive reduction changes that. If AI-created documents are
meant to look as good as the built-ins, this is the thing to fix, not the node
count.

Corrections to my own reasoning it forced:

- "The AI never sees the render vocabulary" is FALSE for agents.
  `list_document_templates` returns complete definitions and `create_item_type`
  returns the compiled one. I had found this myself earlier in the session and
  then argued the opposite.
- "Legacy files mean the schema can never shrink" confuses the import boundary
  with the engine model. `schemaVersion`, `engineVersion` and `formatVersion`
  all exist and none dispatches anything: they are labels, not a migration
  system. A v2 is possible; it is expensive, not impossible.
- "The two-layer design already exists" is FALSE. The blueprint is compiled at
  save and DISCARDED, so the semantic source is destroyed and the compiled
  output is what gets stored, exported, imported and handed to agents. That is
  two public languages with the higher-level one thrown away, not source plus
  IR.
- Total public concept surface it counted: ~90, above 110 if layer-specific
  variants are not deduplicated. The three merges I made removed three names
  from that.

## Where the simplification landed (2026-08-29)

Done, verified by 13 of 13 browser evals including nine real-model briefs:

- Render nodes: `meta`, `space` and `media` accepted and rendered; seven legacy
  spellings normalise into them AT THE RENDERER. Canonical set 22 -> 18. Legacy
  acceptance is permanent, so the schema itself grew, 17 union members to 20.
- Authoring grammar: scalar `display: "fact"` and collection `index` removed,
  both being second names for something already expressible. `cover` and
  `toggle` now refused on the wrong field type instead of being ignored.
- The nine-brief look suite ran clean and the new guards never fired, so the
  repair-convergence risk they introduce is not live in practice.

Left alone on purpose:

- `stack` absorbing `group`/`masthead`: not behaviour-preserving. Three
  genuinely different CSS treatments; merging moves the discriminator rather
  than removing it.
- `field` absorbing `badge`/`toggle`, `rows` absorbing `checklist`: both need
  nested unions to stay sound, and "field" already means the stored schema.
- Base collection versus `defaultView`: the compiler does discard base settings
  when a default view is named, which is real duplication, BUT `FolderPage`
  uses the presence of `defaultView` to decide whether to offer a separate
  "Main" entry in the view switcher. It is a product behaviour, not just
  redundancy, so the fix is a design change rather than a deletion.

The rule that made all of this safe: reduce what the model is OFFERED, keep
what is STORED permissive. Only the transient half can shrink.

## The render vocabulary is not the one the AI writes (2026-08-29)

- The primitive reduction was aimed at the render nodes. Three merges in, two
  measurements stopped it.
- The schema GREW, 17 union members to 20, and always will: legacy spellings
  must be accepted permanently because an exported `.textpack` carries a whole
  look and never expires. Only the CANONICAL set the renderer uses shrinks,
  22 to 18.
- The AI never sees render nodes. It writes BLUEPRINTS
  (`item-type-generation.ts`), which the compiler turns into render specs, and
  `render-spec.md` says the page is deliberately not fed to the model. So
  reducing render-node names does nothing for "the AI generates document kinds
  from a simple grammar".
- The two-layer design was already there: `people` compiles to
  `reference + semantic`, `recurrence` to `enum` with preset options. Small
  primitive set, richer authoring vocabulary on top.
- Work redirected to the BLUEPRINT grammar, which is transient. Saving compiles
  it and persists only the TemplateDefinition, so it can change with no
  migration and no compatibility layer. That is the lever the render spec does
  not have.

## Silently ignored beats wrongly rejected, but not by much (2026-08-29)

- The compiler honours `display: "cover"` only when the field is an image and
  `display: "toggle"` only when it is a boolean. Anywhere else it fell through
  and the instruction vanished. A model asking for a cover on a text field got
  a plain fact and no explanation, which is the one outcome it cannot learn
  from.
- Both are refused now, naming the field and its type. Codex confirmed the
  message reaches BOTH paths: the studio's repair prompt carries it verbatim,
  and `create_item_type` returns it as `arguments_invalid`.
- The cost, and it is real: a generation that used to succeed with a silently
  downgraded field can now end in a visible failure if repair does not converge
  within its bounded retries. That is the trade, taken deliberately.
- The rule cannot live in the emitted JSON Schema, because a conditional is not
  expressible there and `superRefine` is dropped from the generated schema. So
  it is stated in `ITEM_TYPE_BLUEPRINT_FORMAT` as well. Without that, a
  tool-using model learns the rule only by having a call refused.

## Two dead choices in the authoring grammar (2026-08-29)

- Scalar `display: "fact"` was never branched on. A plain scalar falls into the
  facts strip whether it says "fact" or "auto". Removed. Computed fields keep
  their "fact", where it is the meaningful not-"progress" case.
- Collection `index` is the same layout as `list`: the page renderers map one
  to the other and say so in `content.ts`. Removed from the blueprint and the
  studio picker. 34 stored looks still carry `index` and still validate,
  because `collectionRenderSchema` keeps accepting it. Verified both.
- The split that makes this safe: reduce what the model is OFFERED, keep what
  is STORED permissive. Only the transient half can shrink.
- A `.transform()` was the first attempt at folding "fact" into "auto". It
  broke 16 test files with "Transforms cannot be represented in JSON Schema":
  the blueprint schema becomes the tool argument schema handed to agents, so it
  must stay representable. Removal, not aliasing, is the move there.

## Every marker in the render gate was vacuous (2026-08-28)

- `scripts/verify-template-render.ts` proves a composed node "left markup" by
  searching the rendered HTML for its class. Every render embeds the whole
  engine stylesheet, which contains a rule for each of those classes, so
  `html.includes("tt-badge")` was true for every template whatever the renderer
  did. All ten markers, since the gate was written.
- Found while adding two more and testing whether they had teeth. They did not,
  and neither did the originals.
- It matches `class="..."` now. Verified by disabling renderer normalisation:
  7 templates fail, and 0 with it back. It also renders `collection.item`
  through `DocumentCollectionRenderer`, which was never walked, and covers all
  29 resolvable looks rather than the 11 active ones.
- The lesson generalises past this file: a substring check against a document
  that carries its own stylesheet proves nothing. Anchor on markup.

## Reader first, or the rollback floor moves under you (2026-08-28)

- Step 1 of the primitive reduction first normalised legacy node names ON
  PARSE. Codex's review of the diff found that this rewrites the object every
  serializer downstream then writes out, so sync, look export and newly
  compiled item types would all have begun emitting the new vocabulary at once.
- A `.textpack` exported after that cannot be read by an earlier build, and no
  database migration reaches a bundle already on someone's disk. The rollback
  floor would have moved without anyone saying so.
- Normalisation happens at the RENDERER now. Both spellings are accepted and
  both render; nothing new is emitted. Reverting the commit leaves nothing
  behind that an older build cannot read.
- The compatibility floor is therefore permanent. A later step removes legacy
  EMISSION, never legacy acceptance.
- Reviewing the plan did not find this. Reviewing the diff did.

## PostWorkspaceShell cannot be split by script (2026-08-28)

- 7,226 lines, 93 top-level definitions. The sidebar looked like a clean seam:
  lines 1054 to 2198 are entirely sidebar (folder tree, its keyboard nav, the
  activity strip, the chrome) and all four components are file-local.
- Extracting it left 49 unresolved names, of which only 14 were local and all
  of those were sidebar-adjacent leaves that belong in the module. So the seam
  IS clean and the extraction is worth doing.
- It was not completed. Five successive attempts at scripted surgery each
  produced a different wrong edit: a pruner that counted references only inside
  one file and deleted two components the pages import, then cascaded into a
  2,789-line one; an import-stripper that ate destructured props; another that
  ate an aliased import; a prologue extractor that ran past the imports into a
  function body; and a block-end detector that took a fragment of a neighbouring
  function, which silently damaged the source file as well as the target.
- Do this one by hand, or with a tool that parses TypeScript rather than
  matching text. Every heuristic above looked right on inspection and was wrong
  on real code, and two of them were caught only because `tsc` failed
  afterwards. On a file this size, a `tsc`-clean bad edit is entirely possible.

## What is NOT bloat, checked (2026-08-28)

Owner's scope: create documents with the AI, ask the AI to act, templates,
collaboration. Everything measured against that. Four things looked like
candidates and are not:

- **The seven "unreferenced" API routes** (`files/[id]/assets`, `artifacts`,
  `collab/materialize`, `collab/presence`, `folders/[id]/manifest`,
  `post/body`, `items/capture-status`, 936 lines) are all LIVE. The Mac builds
  those URLs by interpolation, so a literal search for the stripped path finds
  nothing. Verified by searching the tail segment instead: between 3 and 13
  call sites each. Deleting on the first result would have removed working
  API.
- **`src/lib/pool/`** (1,900 lines) is the workspace payload the UI and the
  assistant context both read. Core, despite the opaque name.
- **app-health** (~3,430 lines across TS and Swift) is out of PRODUCT scope,
  but `release/ship.sh` and `release/promote-local.sh` both consume its
  attestation and call `verify-app-health.sh`. Removing it breaks shipping.
  Out of scope is not the same as removable.
- **The 18 retired templates** (~2,000 lines of templates.ts) are kept
  resolvable for pinned documents, and every one of them has a pinned document
  in the local database because the showcase creates one per exemplar. Whether
  any real document uses them is a production question, and production is the
  owner's to check.
- All 32 npm dependencies are imported somewhere.

The rule this keeps proving: search for how a thing is CONSTRUCTED, not how it
is declared. Dynamic URLs, interpolated ids and re-exports all hide the reader.

## Superseded limbs, left attached (2026-08-28)

- Owner's read of the repeated write-with-no-reader failures: the substrate is
  convoluted enough that dead code is the ambient condition, so a new piece of
  it does not stand out. Checked, and it holds.
- `src/app/editor/actions.ts` carried nine server actions nothing called, each
  PAIRED with the live one that replaced it: `savePostAction` beside
  `saveEditablePostAction`, `createPostAndRedirectAction` beside
  `createWorkspacePostAction`, and a whole `sharePostAction` /
  `revokePostShareAction` / `listPostSharesAction` trio beside the `*Scope*`
  ones that superseded them. Every migration added the new limb and left the
  old one attached. With their now-orphaned helpers that was 297 lines.
- `src/lib/mcp/local-client.ts` was the loopback MCP client, retired when the
  contract said agents on this Mac use the CLI. Its three functions were dead;
  what remained was one type, a dead private helper and a re-export nobody
  imported. The type moved to its only user and the file is gone.
- 469 lines removed in total, tests unchanged at 1559, lint warnings 60 -> 58.
- STILL OUTSTANDING, and the largest single piece: `PostWorkspaceShell.tsx` is
  7,339 lines with 97 top-level definitions, 178 hook calls, and 31 imports it
  never uses, including whole components it no longer renders. Not touched
  here: it is the main workspace UI and splitting it is a change with real
  risk, not a cleanup.
- Method note: the first audit reported 26 dead exports and a later run of the
  SAME script reported 149. The first run had been truncated. Neither number
  was the answer: 125 of the 149 are merely exported and used only in their own
  file, and 10 of the remaining 24 were used by scripts/ or mac/, which the
  src-only search never looked at. The verified figure was 14. Widen the search
  to the whole repo before calling anything dead.

## Audit: which new code had a reader, and which only had a writer (2026-08-28)

- After being caught reporting phase 3 done when half of it did not work, I
  audited every symbol added in this run for call sites versus test files.
  Three had no proof the path executes:
  - `installDocumentTemplate`: the route branch is guarded on `access.blogId`,
    and every existing test's access mock omits it, so the branch was never
    entered and the suite passed regardless. There is now a test that supplies
    a blogId, and it fails when the branch is disabled.
  - `itemTypeExamplesFor`: unit tested in isolation, and nothing asserted the
    block reached the prompt. Deleting the call site left every test green.
  - `templatesForPosts` / `templateForPost`: call sites and zero tests, so the
    route could have stopped resolving a look unnoticed.
- All three now have tests, and each was verified to FAIL when the production
  line is removed. A test that cannot fail is worth less than no test, because
  it is counted.
- The general shape, third time in two days: code that is written and never
  read looks exactly like code that works. `capabilities`, then the outbound
  half of `template.json`, then these. The check is cheap: for anything new,
  find the read, and make something fail when it goes away.

## The look travelled out and never back (2026-08-28)

- Shipping `template.json` was called done when only half of it existed. The
  definition flowed server to envelope to bundle to file, and nothing read it
  back: `encodeSyncDocument` never sent a template, the write route never
  accepted one, and no import path applied one. A textpack carried its look
  everywhere and the receiving side threw it away.
- Closed. The Mac sends `template` on create and on both PUT paths, the write
  route installs it, and `installDocumentTemplate` stores it at the EXACT id
  and version the document is pinned to. Not `createDocumentTemplateVersion`,
  which bumps to the next free version and would leave the document pointing
  at a look the workspace does not have.
- A look already present wins over the arriving one, and a malformed one is
  dropped rather than failing the write. The words are what is being saved.
- The protocol gained the look-carrying calls with forwarding defaults, so the
  test fakes still conform and only the live client transports it.
- The lesson is the one from `capabilities` in a new coat: a value written by
  one side and read by nobody looks exactly like a working feature. Trace the
  read before believing the write.

## The look suite, after the measurement was fixed (2026-08-28)

- Every one of the nine briefs now records fields and an index that renders.
  habit-tracker, which a plan described as producing "no fields at all", records
  runDate, distance and notes; reading-notes records six. Neither was a model
  failure. The eval was measuring the folder it seeded while the assistant put
  its type on a folder of its own.
- The baseline was re-recorded, which is normally laundering and is not here:
  the measurement target changed on purpose, so the old numbers describe a
  different question. The drift it reported was almost entirely additive, more
  fields visible rather than fewer, which is what a measurement fix looks like.
- `create_item_type` now applies the same quality bar the studio route applies.
  A type that promises structure and has no properties is refused with a
  sentence the model can act on. Until then the tool had no opinion and the
  studio's revision round existed on only one of the two lanes reaching the
  same executor. Check both lanes whenever you add a rule to either.

## Corrections to two things I had wrong (2026-08-28)

- **There are 11 built-in templates, not 29.** Grepping `id: "texttext.*"` in
  templates.ts counts the 18 RETIRED definitions too, which are kept resolvable
  only so documents pinned to them still render. `BUILTIN_TEMPLATES` is the
  active set. Anything showing templates to a model must use the active set:
  the retired ones were taken out of the catalogue at the owner's request.
- **The textpack already carried the fields and the template reference.**
  `info.json` does not, which is what I checked, but the bundle also writes
  `document.json` with the whole `DocumentSnapshot`, and the sync envelope has
  carried it all along "so presentation-only edits cannot disappear during
  sync". The real gap was narrower: an id and a version mean nothing outside
  the workspace that stores the look. `template.json` now sits beside
  `document.json` with the definition inlined, and the reference stays, so a
  workspace that knows the look uses its own copy and everyone else renders
  from the file.
- Look for the existing mechanism before building one. I had a second copy of
  presentation-in-frontmatter written and passing tsc before finding the
  envelope that already did it.

## The look suite fought the dev server for .next (2026-08-28)

- `npm run evals` reported "12 passed" on 2026-08-27 and could not be made to
  do it again from a clean start the next day. The suite was not flaky; it was
  order-dependent, and nothing recorded the order.
- `eval:sidebar` spawned its own `next start -p 3180`, which serves whatever
  `.next` holds. `next dev` on 3000, which the other eleven evals need, writes
  that same directory. So did `vercel build --prod` during a deploy. Whichever
  wrote last decided whether the eval could sign in, and the preflight blamed
  the build every time, including when nothing was listening on 3180 at all.
  Nothing anywhere documented how a server was supposed to get onto that port.
- It now reuses a server that is already answering and only spawns one when
  nothing is there, so its need is "server" and not "build". The preflight
  tells "nothing is answering" apart from "answered, but the build has no dev
  sign-in", because those want opposite fixes.
- `buildHasDevSignIn()` in the runner only checked that `.next/BUILD_ID`
  existed. It reported `ok build` for a build with no dev sign-in in it, which
  is the precondition reporting the opposite of the truth. Deleted.
- Drift in the look baseline does NOT set the exit code, by design: it prints
  and returns 0. Worth knowing before reading a run as green. On 2026-08-28,
  seven of nine briefs drifted with no relevant code change, which says the
  baseline pins the model's field labels rather than the engine's behaviour.
  Left as-is and not laundered with `--update-baseline`.

## tsc passes files tsx cannot run (2026-08-28)

- `npx tsc --noEmit` checks `scripts/` as ESM. `tsx` runs them as CJS, where a
  top-level await is a hard transform error. So the gate can be fully green on
  a script that dies on its first line, and the eval runner reports it as a
  plain FAIL with an esbuild stack where the reason should be.
- `src/lib/__tests__/scripts-load-under-tsx.test.ts` transforms every
  `scripts/*.ts` the way tsx does. On the first run it found
  `finish-pending-account-deletions.ts`, which ends in `await main()` and could
  never have run, despite a header documenting the exact command for a human to
  type. That script finishes interrupted account purges, so the failure was
  sitting in front of deleting data someone had asked to have deleted.

## Browser eval state, all green (2026-08-27)

- Run with `NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000 TEXTTEXT_AI_BASE_URL=http://localhost:3999/v1 npm run dev`
  plus `node scripts/mock-ai-provider.mjs`. Both matter: without the root
  domain the tenant subdomain serves the marketing landing (eval:home-layout
  now says so instead of failing four look checks), and without the mock every
  assistant turn answers "The assistant could not finish that."
- Green as of this date: `eval:features`, `eval:home-layout`, `eval:folder-look`,
  `eval:save-as-look`, `eval:item-type`, `eval:assistant-create`,
  `eval:turn-receipt`, `eval:turn-progress`, `eval:native-create`.
- `eval:item-type`'s first run after a recompile can fail two board checks on
  timing. It passes on a warm server; two consecutive clean runs is the bar.

## The item-type eval was dead, and why (2026-08-27)

- `npm run eval:item-type` had been failing at its third check for long enough
  that a session called it environmental. It is not: it injects its own
  `window.webkit.messageHandlers.textTextApp` shim and needs no real agent.
- Its fake bridge predated conversation fencing. Every native event is now
  checked against `nativeConversationRef` and the turn fence, and the item-type
  design turn runs in its own invisible conversation (`item-type:<id>`), so an
  event with no `conversationId` is answered with "this assistant turn is no
  longer active" and the studio waits out its 120s timeout. The shim now echoes
  the id it was given. 22 behaviours run again.
- The lesson generalizes: a hand-written fake of the native bridge is a second
  implementation of a protocol, and it rots silently. When a native contract
  changes, `scripts/verify-item-type-live.ts` is the other end of it.
- Its first two checks kept passing while everything after them was dead, which
  is what made it look like a flake rather than a wall. The failure now names
  the URL, whether the turn was posted, and what the studio is showing.

## Deploying the web app alone (2026-08-27)

- `npm run deploy:web` (`release/deploy-web.sh`) is the ONLY hand path to
  production for the web app. It is not a release: no Mac version, no appcast,
  no store. `release/ship.sh` still owns those.
- It exists because a hand-run `vercel build && vercel deploy --prod` is three
  steps short of safe, and on 2026-08-27 all three bit in one evening:
  1. **The database was behind the build.** ship.sh migrates first; the hand
     path did not. A build expecting `api_tokens.kind` went live against a
     database without it. Every HTML route answered 200 and the Mac window
     showed "Cannot reach https://texttext.app", because the only request that
     reached the broken query was its session exchange, and a malformed token
     is rejected before the query, so hand probing showed a healthy 401.
  2. **The domain does not follow a CLI deploy reliably.** texttext.app is an
     alias that must be promoted, and sometimes the deploy takes it and
     sometimes it does not. "Deployed" read as "live" while the old build
     served.
  3. **Nothing checked.** The breakage was found by looking at the app.
- So the script migrates, builds, deploys, records what the DOMAIN currently
  serves (`vercel inspect texttext.app`, not the newest deployment), promotes,
  waits to SEE the new deployment id on the domain, verifies, and puts the old
  one back if verification fails.
- `npm run verify:deployment <origin>` is that verification on its own. Its
  load-bearing probe is `POST /api/app/session` with a WELL-FORMED unknown
  token: 401 is healthy, 5xx means the build and the database disagree.
- Traps found while building it, all of which produced a failed deploy and no
  production change: a user-configured `NEXT_DEPLOYMENT_ID` must be unique per
  project (so it carries a timestamp, not just the commit); a dev server on
  :3000 writes `.next` while the build reads it, and Vercel then rejects the
  output with no message; and `vercel promote` exits 409 when the deploy
  already took the domain, which under `set -e` skipped the verification.
- The Mac window now names the failing URL and the error domain and code on its
  unreachable page, and logs the same line to `app.texttext.mac:web-navigation`.
  "Cannot reach" with neither is a dead end: a policy cancel, a DNS failure and
  a refused connection all read the same. WebKitErrorDomain 102 is the app's own
  `decisionHandler(.cancel)`, not an unreachable server.

## Mac app: editions, TestFlight, sign-in

- Distribution model (owner, 2026-08-11): Developer ID + Sparkle is the
  everyday lane; TestFlight for shareable builds; no Store submission.
- One canonical install at `/Applications/TextText.app`, either edition.
  `release/ship.sh` replaces any edition and sweeps numbered duplicates;
  `npm run testflight:prepare` handles the reverse direction before a
  TestFlight install (Apple's installer will not overwrite a Developer ID
  copy; it creates "TextText 2.app").
- Both editions share state in `<app group container>/TextText` via
  `AppGroupContainer`; outside the sandbox the system's `containerURL()`
  answer is a lie (naive path) and is trusted only when
  `APP_SANDBOX_CONTAINER_ID` is set. One-time copy migration, container wins.
  `~/Library/Group Containers` is unreadable from a shell; "0 files" from
  `find` there means nothing.
- Store builds require: `com.apple.application-identifier` +
  team id signed into every bundle whose profile asserts them (90886);
  `LSMinimumSystemVersion` in extension plists (90360); a compiled
  `Assets.car` with `CFBundleIconName` (ITMS-90546, passes local validation
  and fails after upload). Profiles live in gitignored `mac/profiles/`;
  Store builds only work from a checkout that has them.
- Sign-in is an `ASWebAuthenticationSession` sheet against
  `/connect/app/native` (callback scheme hard-coded server-side; the app
  rejects unknown `state`). Device-link (`/connect/link`) remains for CLI and
  headless. Google refuses OAuth in embedded webviews; that is why the sheet
  exists.
- Sign-out is one native operation: web asks the bridge, the app clears
  credentials/index/File Provider state, then clears only the host's Auth.js
  cookies and loads `/signin`. The old split sign-out (web-only or
  native-only) produced the owner-sees-public-empty-blog dead end.
- `getBlogEditAccess` compares `blogs.owner_id` with the session `userId`
  (resolving legacy JWTs through `user_identities`), never provider subjects.
- ASC credentials: login Keychain service `asc` (JSON: `key_id`,
  `issuer_id`); .p8 in `~/.appstoreconnect/private_keys`. TestFlight internal
  group "Internal"; the owner must be enrolled as a tester like anyone else.
- `release/prepare-testflight-build.sh` is the non-uploading package boundary.
  It builds the Store edition, verifies Apple Distribution signing, arm64 app
  and extensions, App Sandbox, application identifier, team-prefixed app
  group, embedded profile, and absence of Sparkle, then signs a `.pkg` with a
  3rd Party Mac Developer Installer identity. It never uploads, installs, opens
  TestFlight, or changes `/Applications/TextText.app`.
  On 2026-08-19, the real Apple Distribution build completed with all three
  signed arm64 extensions, and the command produced a 3rd Party Mac Developer
  Installer-signed `0.181 (184)` package in an isolated temporary directory.
  Signature verification passed; the proof package was moved to Trash. Nothing
  was uploaded or installed.
- `npm run testflight:build:test` is the fixture contract for that boundary and
  is a required release check. It proves that an unsandboxed app or a zero
  build number cannot become a TestFlight package.
- `npm run eval:native-codex` is the real standalone-channel runtime probe. It
  verifies the signed-in account, a read-only ephemeral thread, isolation from
  inherited MCP servers, one safe dynamic tool call, and the exact response.
  It is deliberately not a release gate because provider availability and
  account usage limits are external. A quota failure remains red and must not
  be described as runtime proof.
- Channel capabilities are intentionally different. The standalone Developer
  ID app can launch the local Codex runtime and includes
  `Contents/Helpers/texttext`. The App Sandbox prevents TestFlight from
  launching `~/.local/bin/codex`, and the Store bundle excludes the CLI. In
  TestFlight, use a provider API key or an external hosted MCP/app connection.
- The hosted MCP endpoint uses manually created `wsk_` workspace bearer tokens.
  TextText has no OAuth authorization server. OAuth-only clients cannot connect,
  and ChatGPT custom MCP availability varies by plan, role, and workspace
  policy. Do not promise a universal one-click ChatGPT connection.

## Finder and CLI verification (2026-08-19)

- The bundled CLI used to turn every File Provider enumeration error into an
  empty list because `DocumentStore.list()` used `try? ... ?? []`. It now fails
  with an actionable unavailable-workspace error. It lists and edits
  `.textpack`, `.textbundle`, `.md`, and `.txt`, and skips the auxiliary `Data`
  tree. An isolated CLI round trip proved list, read, append, lint, and reread
  against a real `.textpack` without touching owner data.
- The GUI does not own `sync.index`; File Provider is the sole sync owner. A
  missing legacy index is a passing transition state. A surviving index must
  still decode or health fails.
- A File Provider status with zero pending errors is not proof that Finder is
  usable. For a linked account whose domain is enabled or unknown,
  `finder.provider` passes only after the real CloudStorage root enumerates and
  exposes at least one workspace folder. The root-level attachment `Data`
  directory does not count as a workspace.
- On 2026-08-19 the installed mount existed at
  `~/Library/CloudStorage/TextText-TextText`, but shell enumeration returned
  `Operation not permitted`, and `fileproviderctl dump
  app.texttext.mac.fileprovider` showed the provider and mount xattrs without an
  active `domain:` section. That state is not a successful Finder proof. If it
  persists and Finder access is wanted, the owner can enable TextText in
  **System Settings > General > Login Items & Extensions > File Providers** and
  reopen TextText. Finder access is optional. A registered domain that the user
  disabled is a healthy app state and is recorded only in numeric health
  metrics. An absent domain for a linked account and an enabled domain that
  cannot expose a workspace remain health failures.

## Public URLs (live since 0.175)

- Shape: `<handle>.texttext.app/<folder path>/<slug>` on a sessionless public
  origin; the proxy strips Cookie/Authorization and preflights locations so
  drafts, private items, dead tombstones, missing paths, and unknown hosts
  all return byte-identical constant 404s.
- Private work stays on the root origin (`/@writer/...`), which keeps auth,
  editing, shares, collaboration.
- `posts.folder_id` is required; live uniqueness is `(folder_id, slug)`;
  `public_url_tombstones` + DB triggers reserve every public path across
  rename/move/unpublish/trash/merge/delete; a tombstone redirects only while
  its target is still public; advisory locks serialize path checks.
- One eligibility rule everywhere: public visibility AND published status AND
  article-like type. Feeds, sitemap, OG, JSON, robots, sync canonicals all
  emit workspace origins and enforce it.
- Legacy flat `/t/` and `/@` links redirect through frozen tombstones only
  for pre-migration items.
- Public footer links to the platform (report) must be absolute; relative
  links get rewritten as tenant content.
- Owner constraint: a content leak torpedoes the app. Leak tests live with
  the migration; keep them green.

## Data and canonical documents

- One schema-v1 `DocumentSnapshot` is the content model; store.ts is the only
  access point; visibility fails closed; every mutation audits.
- Search/list projections (title/body columns) are derived from the snapshot;
  the invariant lives with the canonical-documents work (2026-08-10).
- Account deletion: CLOSE (atomic) then PURGE (resumable); tombstones fence
  resurrection; audit rows are anonymized, never deleted.
- Account merge tooling was removed 2026-08-14 (spec: superseded by
  `user_identities` provider linking; recoverable in git history).
- Starter guides seed at provisioning (`starterAgentGuideValues`);
  `backfillWorkspaceAgentGuides()` retrofits older workspaces; both are
  idempotent per `(folder_id, slug)`.

## AI-assisted item types (2026-08-19)

- Home, every folder menu, and the Assistant open one focused item-type
  studio. A prompt or the Editorial publication, Project board, and Quick
  notes starters produces one validated blueprint for both an item page and
  its folder page.
- `item-type-blueprint.ts` is the complete input contract. It compiles fields,
  item layout, collection layout, safe theme tokens, and example content into
  one immutable `TemplateDefinition`. Internal fields are hidden from the
  document editor.
- The UI, in-app assistant tools, and hosted MCP use
  `createItemTypeForWorkspace()` as the single persistence path. Saving can
  set a folder default and can explicitly restyle existing folder items. New
  items inherit the folder type.
- The focused studio prefers the native Codex with ChatGPT connection for
  custom prompts. It registers a preview-only `preview_item_type` dynamic
  tool, validates the returned blueprint, and saves nothing until Done. A
  direct provider API key remains a fallback, not a requirement for this path.
- `npm run eval:item-type` drives the real browser flow through creation,
  inheritance, editing generated properties, board movement, and reuse from
  the Look gallery. `npm run eval:features` checks the documented entry,
  starters, and dual previews.
- `/docs/item-types` is the public guide. A private Notes guide titled "Build
  item types with AI" is provisioned and backfilled with the other AI guides.
- The visual sweep covers 1440, 768, and 375 pixels in light and dark. On
  2026-08-19 every listed surface painted with no horizontal overflow. The
  item-type prompt, item preview, folder preview, controls, and guide were
  also inspected as pixels at desktop, tablet, and phone sizes.
- Real Keychain-backed Anthropic prompts were exercised for Medium-like
  essays, a Notion-like task board with a checklist, and Apple Notes-like
  notes. Provider generation uses validated JSON rather than the provider's
  constrained grammar because the complete blueprint exceeds Anthropic's
  optional-property limit. One bounded repair pass handles invalid model JSON.
- The focused studio keeps a 30-revision local design history with undo, redo,
  branching, version switching, and a before/current comparison. Preview modes
  cover wide, tablet, and phone frames plus sample, real folder, empty, and
  stress content. A deterministic preflight scores the current blueprint and
  blocks Done only for important findings.
- Blueprints can model people and document relations, recurrence, validated
  values, conditional sections, computed facts, and status workflows. Status
  controls expose only the initial state or transitions allowed from the
  current state. People fields store canonical document references and use a
  searchable workspace picker with a manual ID fallback.
- Collections can preserve multiple named views with their own layout,
  filters, grouping, date field, and multi-sort. A compact folder control
  switches views without changing the underlying documents.
- The Look library is a searchable visual catalog with Mine, Workspace, and
  TextText sources, real rendered previews, impact counts, Remix and Save as
  new, validated JSON import, export, immutable versions, and restore-forward.
- Native assistant turns are grounded in the active view, document, and safe
  selected text. Transformation shortcuts expose the same workspace update
  tools as typed instructions; Structure produces a reversible full-body
  proposal rather than editing around the document command surface.
- The final 2026-08-19 gate passed 924 web tests, 456 Swift tests, TypeScript,
  the 42-page production build, the item-type, feature, look, home-layout,
  outbound MCP, collaboration, and real-model sidebar evaluations, plus 36
  inspected light/dark screenshots across 1440, 768, and 375 pixel widths.

## Agentic writing simplification (source, 2026-08-20)

- The product now has one primary agentic-writing loop in the right rail:
  choose the current document or workspace context, ask for a concrete change,
  watch bounded progress, and read the attributed result. Selection quick
  actions use an explicit proposal with Apply and Undo. Provider plumbing and
  fallback connection paths stay progressively disclosed.
- Home no longer repeats an AI setup card. The rail starts the work, Workspace
  Settings manages providers, and the public guides explain the available
  channels. `/docs/recipes` is a small visual recipe gallery with copyable
  prompts and real TextText screenshots for connection proof, folder-to-draft,
  selection rewrite, and Undo.
- Connect is edition-aware. The standalone Mac edition can offer its bundled
  local Claude and Codex plugins and eligible ChatGPT/Codex native account.
  Browser and Store editions lead with the API-key in-app assistant and can
  describe hosted bearer MCP as an advanced external-client path. Store and
  browser surfaces do not advertise the standalone CLI or local loopback MCP.
- The local Claude and Codex plugins no longer bundle an MCP configuration or
  ask for an exported token. They call the `texttext` helper inside the
  signed-in standalone app. Hosted `/api/mcp` remains the explicit path for a
  remote client that can securely store a bearer credential.
- The CLI no longer depends on File Provider or a localhost server. It reads
  the signed-in app credential, discovers workspace paths through sync
  manifests, and sends create, read, update, and append operations through the
  shared authenticated workspace-command executor. `TEXTTEXT_WORKSPACE_ROOT`
  is the only explicit offline file mode.
- Remote CLI writes use command hashes, bounded input, workspace and scope
  checks, stable idempotency keys, and attributed audits. Whole-document writes
  refuse an active-editor conflict. Section edits use a guarded section
  mutation against the live Yjs document so concurrent changes outside that
  section survive and a changed target section conflicts.
- Agent-driven content, status, restore, comment, access, share, and live Yjs
  mutations now couple the data change and `action_audit` row atomically.
  A failed audit cannot leave an unattributed change, and an idempotent retry
  cannot duplicate either the content operation or its audit.
- Native recent-work summaries receive a bounded workspace index and answer
  from it without tool calls. A real signed-in Codex evaluation proves the
  read-only sandbox, disabled inherited MCP servers, numeric JSON-RPC request
  IDs, bounded failure recovery, and exact dynamic-tool completion. A separate
  browser/WK bridge evaluation uses a disposable local document to prove the
  rendered summary, real command execution, visible edit, AI audit, proposal,
  Apply, and Undo, then removes its fixture.
- The desktop shell gives the center document or library sole vertical scroll
  ownership. Left navigation and the assistant remain pinned. The visual sweep
  asserts that contract on Home, folders, editor, Starred, Shared, Trash, and
  Settings at 1440, 768, and 375 pixels in both themes.
- The settled-tree gate passes 995 web tests, 493 Swift tests, TypeScript,
  lint with zero errors, both agent integration verifiers, the real native
  Codex evaluation, the browser/native bridge evaluation, the transactional
  local-promotion fixtures, and the 43-page production build. The build still
  reports the known non-blocking duplicate-Yjs warning from separate Turbopack
  route chunks; one installed Yjs version and serialized route boundaries were
  verified.
- TestFlight preparation, App Store Connect changes, release records, and live
  Apple/Google account consent remain owner-run gates and were not performed in
  this source pass.

## Agentic writing promotion (2026-08-20)

- Source commit `9889818dca14b5e33b55664b17aae73ac269f0e8` was promoted through
  the deliberate production and canonical-local lane as TextText 0.181 build
  194. Production deployment `dpl_G5N6z6xfJWGp7wPqJYDBi1XvUVSY` is ready at
  `write-n5tzam0pm-shoku-s-projects.vercel.app`, and `texttext.app` points to
  that exact deployment. The prior immutable deployment was recorded before
  the alias changed.
- The production migration set and canonical document audit passed with 953
  documents, 919 live items, 34 trashed items, and all 953 using TextPack. The
  authenticated production smoke passed all 17 folder, item, comment, cover,
  sharing, access, capture, audit, and cleanup checks.
- The transactional installer replaced the single canonical app at
  `/Applications/TextText.app`, launched it, and passed fresh runtime health.
  Independent verification found one matching bundle, one app process, the
  production server origin, a strict valid Developer ID signature, and the
  arm64 app plus three signed extensions.
- The installed app was inspected and exercised directly. The center library
  scrolls while both sidebars remain pinned. A real recent-work request showed
  visible progress in about one second, completed successfully, and returned a
  grounded summary of the workspace without fallback or waiting prose.
- `/Applications/TextText.app/Contents/Helpers/texttext ls` succeeds against
  the signed-in workspace without a File Provider mount. No TestFlight,
  App Store Connect, Sparkle publication, or release-record action occurred.

## Local promotion and TestFlight state (2026-08-19)

- The complete promotion gate now passes 926 web tests, 460 Swift tests, 17
  local live workflows, 17 production MCP workflows, the production database
  audit, a protected immutable-deployment smoke, and the public origin smoke.
  Vercel protects immutable deployment URLs even when `texttext.app` is public,
  so the exact-deployment check uses authenticated `vercel curl`. Plain curl is
  redirected to Vercel SSO and is not an application 500.
- If `vercel rollback` refuses an older immutable target, promotion now restores
  the prior production target by repointing the canonical alias. Both failed
  2026-08-19 promotion attempts left production on
  `write-nkrmtve2w-shoku-s-projects.vercel.app` and restored the canonical local
  app to 0.181 (184).
- The 0.181 (185), (187), and (188) Developer ID candidates were rejected by
  the transactional installer and automatically restored 0.181 (184). Those
  runs exposed an overly strict assumption that a user-disabled optional File
  Provider domain made the entire app unhealthy. The two storage checks now
  record that state without degrading app health, while an absent or enabled
  but unusable linked domain still fails.
- On 2026-08-20 the production-origin Developer ID app 0.181 (189) passed the
  complete release-quality gate, staged 19-check health verification, and live
  installed health. The installer replaced the canonical app at
  `/Applications/TextText.app`; exactly one matching bundle and one process
  remained. Its `TextTextServerOrigin` is `https://texttext.app`. The gate
  passed 929 web tests, 461 Swift tests, authenticated MCP isolation and token
  revocation, 17 sharing workflows, 17 sync workflows, four-client
  collaboration, and 48 Apple checks. No deployment, TestFlight upload, App
  Store Connect change, or release record was made.
- A signed, sandboxed 0.181 (186) TestFlight installer package was prepared at
  `/Users/shokunin/Downloads/TextText-0.181-186-TestFlight.pkg`. It contains the
  arm64 app and all three signed extensions, uses the Apple Distribution app
  identity and 3rd Party Mac Developer Installer package identity, excludes
  Sparkle, and has SHA-256
  `e569c4245716f784f0ed153bc179a6dd150f65421778a5983ec6fa6fd7f12a3e`.
  It has not been uploaded or installed.
- Store builds use a manifest that excludes Sparkle. `build-store.sh` now
  restores the standalone `Package.resolved` on every exit so TestFlight
  preparation cannot remove the standalone Sparkle pin or dirty the checkout.
- The native Codex dynamic-tool evaluation is green against the owner's
  existing ChatGPT Pro session. It starts an ephemeral read-only thread with
  approvals disabled, disables four inherited MCP servers, completes exactly
  one fixed safe tool call, and requires the exact final response. The eval
  accepts numeric JSON-RPC request id zero and reads the authoritative final
  agent item rather than combining commentary with the answer.

## Source-only App Store and AI verification (2026-08-20)

- No TestFlight build, package, upload, install, App Store Connect change, or
  release record was performed in this pass.
- Store compilation reaches `TextTextWorkspaceCore` and compiles the local
  Codex executable locator out under `TEXTTEXT_STORE`. The Store binary scan is
  clean for local Codex paths, the bundled CLI, Sparkle, updater/appcast code,
  relocation helpers, and non-system dynamic libraries. The standalone edition
  retains its local Codex and CLI capabilities.
- Full verification passed: 147 web test files with 929 tests, 461 Swift tests,
  the production Next build with 42 static pages, both agent integration
  verifiers, and the real native Codex evaluation described above.
- The API-key and external MCP paths lead the Store-safe connection UX. The
  standalone edition conditionally offers the local ChatGPT/Codex connection.
  Assistant, settings, and connect surfaces were photographed at 1440, 768,
  and 375 pixels in both themes. The narrow assistant now uses a viewport
  overlay, and the 375-pixel settings cards no longer clip horizontally.
- A disposable `npm run try` build loaded the signed-in workspace in the native
  WKWebView, rendered the Library and assistant, and reached the ready
  "Chat with Codex" state. It did not replace `/Applications/TextText.app`.

## Guarded agentic assistant completion (source, 2026-08-24)

- `docs/agentic-assistant-runbook.md` is the canonical implementation and
  maintenance reference for this work. It documents the data model,
  authorization sequence, cloud and native lifecycles, native scope fence,
  proposal state machines, outbound MCP approval boundary, evidence semantics,
  edition matrix, regression history, verification commands, and deliberate
  gaps. Future Codex and Claude sessions should begin there, then use
  `docs/ai-sidebar-architecture.md` for the system overview and this section for
  the last observed proof.
- An initial completeness claim was incorrect. Three adversarial audit passes
  subsequently found and closed owner-scope mismatches, native relaunch
  continuity, proposal race and ambiguity handling, misleading provenance,
  collaborator selection actions, and accidental outbound discovery from
  ordinary prose. This section supersedes earlier assistant implementation
  claims where they conflict.
- Assistant conversations now have durable owner-only records with stable
  conversation IDs, search, pinning, reopening, bounded cross-device sync, and
  bounded prior-turn context. Cloud follow-ups receive the durable transcript.
  A native App Server thread restores that transcript only when attaching a
  durable conversation to a fresh ephemeral thread, so relaunches preserve
  context without duplicating messages.
- The assistant offers a truthful Auto model choice plus exact supported model
  choices and records the provider and actual model used. Workspace owners can
  set standing instructions and explicit slash or at-sign skills. The composer
  accepts bounded text, structured data, images, PDF, DOCX, XLSX, and PPTX
  attachments. Model Markdown is rendered through the safe renderer and never
  loads remote tracking images.
- Workspace grounding distinguishes documents merely Found from documents
  actually Read. Source proof cards are derived from server receipts, not
  model prose. Eligible cloud workspace changes and every outbound MCP call are
  inert durable proposals until the owner approves the exact stored arguments.
  The standalone native path retains its explicit confirmation gates for
  publication, access, restore, Trash, and destructive asset actions. A stale
  proposal decision replays the authoritative durable outcome. A successful
  side effect whose receipt cannot be saved is terminal and ambiguous, with no
  blind retry.
- Connected MCP servers are never discovered because their natural-language
  name appears in a prompt. Settings shows a unique literal shortcut such as
  `@mcp:paper`; only that exact token authorizes discovery for the current turn.
  Every external call still requires proposal review. Approval revalidates an
  HMAC fingerprint covering the destination, credential identity, and tool
  definition before execution. Shortcut collisions fail closed.
- Assistant status, provider data, transcripts, jobs, item-type generation,
  quick actions, and selection actions remain hidden or disabled until the
  displayed workspace is proven to be the caller's owned workspace. The API
  verifies the same workspace handle before reading configuration, context, or
  executing the privileged assistant command transport. Native registration,
  status, and events are owner-gated; every turn is fenced to its initiating
  opaque owner scope, workspace, and conversation, and navigation cancels it.
  Private assistant status and proposal responses are `private, no-store`.
- Settings now inventories connected AI providers and MCP servers, shows how
  each connection is used, and exposes disconnect or removal controls. The
  standalone local agent path uses the signed-in `texttext` CLI. Store builds
  compile out the local Codex locator and local MCP bridge, retain only ordinary
  App Sandbox entitlements, and do not restore a loopback service.
- Observed behavior used a real Keychain-backed Anthropic provider. An exact
  prompt returned `LIVE AI OK` with an Anthropic and Claude model receipt; a
  grounded question produced distinct Found and Read proof; a create-note
  proposal remained inert and was dismissed; reload retained the conversation;
  and a follow-up answered from prior durable context. The outbound MCP browser
  evaluation passed discovery, proposal-only execution, approval receipts,
  hostile-description resistance, input-required handling, and cleanup.
- Final source gates passed 182 web test files with 1,260 tests, the 45-page
  production Next build, 526 standalone Swift tests, 525 Store Swift tests,
  the 48-point Apple acceptance matrix, TypeScript, lint with zero errors,
  30 current migrations, the token-free agent integration verifier, and the
  outbound MCP browser evaluation.
- Deliberate remaining product gaps are not described as complete: no
  first-party OAuth connector gallery or indexed Slack, Drive, Jira, GitHub,
  mail, and calendar search; no embeddings or cross-service semantic ranker;
  no answer-level inline citations beyond source artifact cards; no generic
  archive, audio, video, transcription, cloud OCR, spreadsheet computation, or
  code sandbox; no team, page-backed, or automatically learned skills; no
  model-readable screenshot verification tool; no bundled unattended batch
  runner; no multi-step Plan mode; and no scheduled custom background agents.
  A persistent background job requires the owner's explicit approval.
- No TestFlight build, store upload, release record, deployment, installation,
  or public release action was performed in this pass.

## Resolved episodes (one line each, dates in git log)

- Apple consent screen "write app": appleid.apple.com caches its own copy;
  only a portal Save syncs it.
- Sparkle stays: it serves the Developer ID lane; TestFlight serves sharing.
- `runtimeServerDeploymentId: false` in next.config.ts prevents the E970
  all-routes-500 outage; do not remove.
- Looks are named Article/Note/Bookmark/Gallery/Talk/Checklist/Project/
  Newsletter; a test fails on competitor names.
- 56-agent visual critique and the 24-check collaboration proof exist as
  repeatable verification lanes.
