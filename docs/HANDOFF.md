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
- `/docs/features` documents only exercised behavior, by rule stated on the
  page. `/docs` indexes it.

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
