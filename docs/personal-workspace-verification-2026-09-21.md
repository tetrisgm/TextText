# Personal workspace verification

Unreleased work. The [build plan](plans/personal-workspace.md) remains the
acceptance contract; this receipt does not mark it complete.

## Destination timing baseline

Production preview localhost:3108, deployment `personal-restore`, application
code at 81e787cf. Local Postgres, visual-demo workspace, desktop browser with
both navigation and AI rails. This fixture has 17 personal timeline items and
one deliberately saved bookmark; it is not a large-workspace benchmark.

CUA drove normal navigation clicks. Temporary CDP instrumentation measured from
capture-phase click dispatch to the animation frame after the destination's
content was present. Tool latency is excluded. Writing requires a writing row;
Bookmarks requires a saved row; News requires a feed row; Home requires its
initial timeline and headlines to have settled. This measures DOM readiness
across frame boundaries, not compositor presentation or image decode completion.

| Destination | First measured visit, ms | Repeat 1, ms | Repeat 2, ms |
| --- | ---: | ---: | ---: |
| Writing | 89.0 | 46.8 | 45.0 |
| Bookmarks | 306.9 | 377.0 | 126.9 |
| News | 327.8 | 110.3 | 89.0 |
| Home | 69.0 | 88.8 | 58.7 |

The first measured visit is not a cold application launch. Initial Bookmarks
shell appeared at 128.1ms and News shell at 43.7ms, before their content was
ready. A longer sampling batch exceeded the tool execution deadline and its
unreturned results were discarded. The two repeat cycles above were collected
after reconnecting. No p95 claim is supported by this sample count.

Code inspection confirms SavedArticles initializes its rows/cursor empty on
every mount and waits for fetchReadingPage; its session stores filters but not
loaded pages. News and Home already retain in-memory snapshots. Next work:
retain a bounded, workspace-scoped saved-library snapshot with revalidation and
access invalidation, preserve loaded-page return position, then repeat the full
navigation benchmark. Cold loading and all other performance gates remain open.

All temporary measurement listeners, timers and probe properties were removed.

## Saved-library return cache

Bookmarks now retains up to four in-memory views of at most 500 rows each,
separated by workspace handle, folder, query and saved state. Returning renders
the retained rows immediately and revalidates the entire loaded window. Focus
and reading-state changes also refresh it. Access/scope failures clear retained
rows; transient failures keep them available with a retry. Pagination and
refresh responses are fenced when the view changes or unmounts.

The Home test directory passes 32 tests; the new saved-library client suite
passes three tests, including denial on a later refresh page. Type checking
passes. Targeted lint has no errors and three existing image warnings.
The isolated local production build passes. Browser timing verification of this
change remains pending; the measurements above describe the previous implementation.

## Source-to-writing destinations

The reader's Add to document action now uses the same authored-writing
classification as Writing. Existing articles and custom documents are valid
destinations; RSS and bookmark sources are excluded. New article creates an
article through the shared create command with the quoted passage and internal
source reference. Existing destinations still use append_to_item with a stable
retry identity.

Nine targeted tests pass, including component command dispatch for new articles,
existing-article append, retry identity and picker membership. Lint passes.
Live multi-source drafting, explicit AI context and concurrent capture remain
unverified; these checks do not close the writing integration acceptance gate.

### Live source drafting check

Built c8a9e3f4 locally in `.texttext/personal-build-sources` with local Postgres;
production build passed, preview `localhost:3110`. CUA used Add to document on
the saved Texttext AI setup guide, chose New article and opened the result:
`587b7efa-2193-4ada-a502-a736e8c23e39`, Draft on Texttext AI setup guide.
The editor showed Article presentation. From News, the NASA water-systems story
was appended to that same article. A full editor reload retained both internal
source references. This checks link-only capture; concurrent passage capture is
still pending.

The context picker could explicitly add and remove the manually saved guide,
with a named chip and workspace index remaining off. It could not find the NASA
source after reload. Inspection confirms the picker searches `displayPool.posts`,
which deliberately excludes most RSS rows. The next fix must provide an
authorized bounded source lookup for the picker without loading every RSS item
or automatically selecting sources. Seventeen context/picker tests passed, but
they use supplied item arrays and therefore do not cover this integration gap.
No AI request was sent during this check.

### Source lookup fix

The context picker now supplements local choices with an authorized reading
metadata lookup, limited to eight search results or five selected IDs. Queries
are debounced and cancelled on change; returned sources remain unselected until
the person chooses one. Selected RSS names can be resolved after reload without
retaining bodies in conversation metadata. The native assistant can fetch the
canonical document for an explicitly chosen source absent from the navigation
pool, rejecting failed authorization and mismatched workspace responses.

Seventeen targeted tests pass for endpoint bounds/access denial, keyboard
selection, stale-search cancellation, selected-name hydration, and canonical
source reads. TypeScript and the local production build pass; lint has no errors
(17 existing shell warnings).

On the fresh `localhost:3111` production preview, CUA reopened the two-source
article, searched NASA Discovery, and selected the actual RSS source. Its named
context chip survived a full reload. The workspace index remained off and no AI
request was sent. A long source name exposed an existing implicit-grid overflow
in the composer; its column is now constrained to the rail width, with a
shrinking title and a visible removal control. The final build
`.texttext/personal-build-context-fit` passes. At `localhost:3112`, CUA verified
the long NASA chip truncates within the 360px rail with its remove control
visible, survives reload with its title, and can be removed. No AI request was
sent. Native-agent consumption is covered by the canonical-read tests, not a
live external-agent turn.

### First-click picker handoff

The initial lightweight assistant rail previously activated the full assistant
on Add context but discarded the request to open the picker. Its containing
boundary now remembers that request for the current workspace/context and opens
the loaded picker on mount. Focusing the lightweight context controls no longer
unmounts them ahead of the click. Ordinary activation does not open a picker.

Twenty-one targeted handoff, keyboard and assistant regression tests pass,
along with TypeScript and targeted lint. A fresh production browser cold-load
check remains pending; the running 3112 preview predates this change.

### Warm-return measurements and startup retest

On production preview 3112 (84fec113 implementation), CUA alternated Writing
and Bookmarks for 21 cycles. The first cycle is excluded from warm statistics.
Click capture starts the timer; the animation frame after a destination row is
present ends it. This is DOM readiness, not image decode/compositor completion.
Nearest-rank p95 over 20 warm samples:

| Destination | First measured visit | Warm p95 | Warm range |
| --- | ---: | ---: | ---: |
| Writing | 64.4 ms | 88.8 ms | 30.5–112.3 ms |
| Bookmarks | 639.6 ms | 59.8 ms | 21.3–94.5 ms |

Bookmarks samples in ms: 33, 25.8, 21.3, 29, 22.2, 24.2, 59.8, 31, 30.9,
27.1, 41.4, 33.4, 37.2, 23.2, 37.4, 94.5, 27.3, 35.9, 27.3, 33.2.
Writing samples: 49.4, 39.9, 34.6, 38.5, 33.9, 30.5, 34.3, 85.7, 34.3,
42.3, 88.8, 112.3, 40.7, 32.6, 47.4, 35.7, 38.8, 36, 48, 57.4.
Fixture remains one deliberate bookmark and the existing small writing pool.
The first Home visit measured 407.6 ms. Initial loads, other navigation paths
and large-workspace performance remain open. Temporary timing probes were removed.

The fresh a55127f6 build passes (`.texttext/personal-build-handoff`, port 3113).
Immediately navigating there and clicking Add context once still did not open
the picker after hydration. Therefore the cold-start acceptance is **not passed**.
The first-click request currently lives inside LazyAssistantSidebar, while its
parent LazyAssistantConversationState replaces its subtree when modules load.
That remount is a likely request-loss boundary not covered by the isolated test;
the fix must retain intent across the parent replacement and thread initialization.

### Startup picker correction verified

The open request now also lives in LocalWorkspaceShell, above the replacing
conversation subtree. The loaded picker adopts the hydrated conversation ID
without discarding that request; closing clears the workspace request.
Twenty-two targeted tests, TypeScript and the fresh production build pass.
Targeted lint has no errors and 17 existing shell warnings.

On `.texttext/personal-build-parent` at `localhost:3114`, CUA navigated directly
to Writing and clicked Add context once. The picker remained visible after
initialization. Repeating with a full reload and one click also passed. Escape
closed the picker and restored focus to Message assistant. No AI request was
sent. This supersedes the failed first-click result immediately above.

## Integration regression run at 05633e02

All commands ran on the Mac with local Postgres. The pre-existing unrelated
attachments.ts and tabs.test.ts changes remained present, so this records the
working-tree environment rather than claiming a pristine-checkout run.

| Check | Result | Local log |
| --- | --- | --- |
| Full `npm test` through `scripts/with-local-database.mjs` | 385 files passed, 17 skipped; 3,568 tests passed, 123 skipped; 58.15 s | `/tmp/texttext-personal-full-tests.log` |
| `.db.test.ts`, scale excluded, `TEXTTEXT_READING_DB_TEST=1` | 14 files, 87 tests passed | `/tmp/texttext-personal-db-tests.log` |
| Reading scale, default 5,000 imported items | 4 tests passed | `/tmp/texttext-personal-scale-tests.log` |
| Agent history, `TEXTTEXT_AGENT_HISTORY_DB_TEST=1` | 4 tests passed | `/tmp/texttext-personal-agent-history-tests.log` |
| `swift test --package-path mac --filter QuickCaptureTests` | 21 tests passed | `/tmp/texttext-personal-native-capture-tests.log` |

The native tests exercise offline outbox storage, retry identity, failed-item
recovery, receipt bounds, workspace isolation and IME key handling. They do not
prove global shortcut delivery from another application, actual input-method
composition, or native reopen latency. The separately gated browser-accessibility
suite was not run by the shell; browser verification uses CUA. Broad responsive,
keyboard-only and native end-to-end acceptance remains open. No app installation
or release occurred.

## Keyboard loop follow-up

On preview 3114, both Cmd+K and Ctrl+K did nothing while Message assistant was
focused. Inspection found that the assistant's Escape layer caused CommandLayer
to defer every non-Escape key before consulting registered shortcuts. Routing
now permits the existing command-palette binding when all active Escape layers
belong to Assistant. Other modal layers and ordinary input remain protected.
Seventeen keyboard/context tests, TypeScript and targeted lint pass. The live
keyboard loop needs retesting in a fresh build containing this change; 3114
still serves the previous implementation.

### Keyboard loop verified on 079965b6

Fresh production build `.texttext/personal-build-palette` passes and serves
port 3115. From focused Message assistant, Cmd+K opens the palette. Using its
search field and Enter, CUA opened Home, Bookmarks, News and Writing, opened
Quiet tools in the editor, and returned with Cmd+[. No pointer click was used
for these navigation actions.

Home capture was reached by 25 Tab presses from the post-palette focus position.
Typing `Keyboard capture September 21` and a second-line body, then Enter,
saved a note and retained capture focus. Palette search reopened it at
`3cec53cf-6154-4571-b513-4e8b849ebb8f`; full reload retained the body
`Verified Home capture using keyboard navigation.` The timeline staged its
arrival behind New items. This proves the navigation/capture/reopen sequence,
not IME composition or live native capture. Twenty-five tabs is too much for
frequent capture; add a direct discoverable capture command using the existing
capture-focus path before closing the keyboard-efficiency gate.

### Direct capture command implemented

The palette now includes `Capture a thought or link` for users who can create
items. It navigates Home and passes a focus request to its existing capture
composer; it does not create an empty document. The command surface and Home
composer now share the same focus request used by folder capture.

Validation: workspace command suite 12 tests passed, TypeScript passed, scoped
ESLint has no errors (17 existing shell warnings), and diff whitespace checks
passed. Browser focus after palette dismissal and repeated capture requests
still require verification in a fresh production preview. Port 3115 predates
this change. Desktop Writing on that preview was rechecked at 1280 CSS pixels:
252px folder sidebar, contextual AI panel, and hidden mobile bottom navigation.
