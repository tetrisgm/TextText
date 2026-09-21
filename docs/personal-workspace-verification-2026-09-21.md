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

### Direct capture verified on 3242b346

Fresh local production build `.texttext/personal-build-capture` passed and is
running at port 3116. From Writing with Message assistant focused, Cmd+K,
`Capture a thought`, Enter opened Home with `Save to TextText` focused. Typing
an unsaved test draft and invoking the command again kept both the exact draft
and capture focus. The test-only draft was cleared afterward. No empty item was
created by either command. This replaces the prior 25-Tab capture approach.
The temporary build TypeScript configuration was removed after server startup.

### Desktop Home return and reload on port 3116

Visual inspection confirms left folders, central capture/timeline, and right AI
in the current desktop Home. Opening the keyboard-capture note and Cmd+[ adds
it to Continue and restores focus to its timeline row. After scrolling down,
opening the 100kB fixture and returning focuses its row. With Continue populated,
a repeat open/back preserves both scrollTop 1721.5 and row viewport top 320.625
exactly. Full reload also restores scrollTop 1721.5 and row top 320.625; document
focus is not restored on reload. The first opening changed Continue's height,
so its numerical scroll offset is not used as proof of exact restoration.

The prior draft cleanup claim was rechecked: empty `fill` had only selected the
text in this browser surface. Cmd+A followed by Backspace cleared it, and a DOM
read verified the capture value was empty. No product change was needed.

### News keyboard mismatch found and corrected

CUA on port 3116 reproduced a focus/selection split: with row 0 focused, J
selected row 1 but document.activeElement remained row 0. The row's Enter
handler opens its own article, so this could open a different item from the
highlighted one. ArrowDown also left both indices unchanged.

HomeNews now moves DOM focus with J/K selection and supports ArrowDown/ArrowUp
through the same path. Focus movement is limited to keyboard navigation, so
opening a row menu does not trigger a focus-stealing effect. Existing scroll
handling remains in place. TypeScript and scoped ESLint passed; 24 related
Artifact/keyboard-routing tests passed. Those tests do not prove browser focus:
a fresh build and the actual J/Down/Enter/back loop remain to be verified.

### News focus movement verified, return hookup added

Fresh production build `.texttext/personal-build-news-focus` passed on a32e817b
and runs at port 3117. CUA verified J changes both active and selected indices
from 0 to 1; Down changes both to 2. Enter opened row 2's Kairos Power article
(`81b9b712-2e08-4269-b96f-7490f29e1f08`), matching the selected headline.

Cmd+[ returned to News at scrollTop 371.5 but focus landed on the content
container, with no selected row. News rows were missing the shared return-focus
attribute. Article and summary rows now expose stable `feed:${unit.id}` keys,
using the existing bounded restoration hook that waits for loaded rows. The
return-focus and Artifact suites pass (see test output for count), scoped ESLint
and whitespace checks pass. The new return hookup requires a rebuilt browser
check; port 3117 proves movement/opening only. Temporary build config removed.

### News return verified on a4e05842

Production build `.texttext/personal-build-news-return` passed and runs on 3118.
CUA selected the WIRED tariffs article with J, opened it with Enter, and returned
with Cmd+[. Both selected and active return keys were
`feed:38820baa-1b68-4e3f-8642-3133490e1f5e`; scrollTop remained exactly 72.
This verifies the previous News return-focus gap is fixed. Temporary build
configuration removed after server startup.

Custom-type inspection also confirms a starter opens manual Name, Properties,
Folder view and Item page controls with a live preview, without sending an AI
request. Back then Cancel exited without saving. The entry screen is still
labelled Build with AI; manual editing is available but insufficiently clear at
entry. Editing/retiring an existing type and export/import remain unverified in
this current browser build.

### Manual type creation entry clarified

Item type studio now explicitly offers choosing a starter and defining fields
and layout manually, alongside an optional AI draft. Its header says Item type;
the AI description textarea has a visible-purpose accessible name. The dialog's
label target remains mounted in both the initial and design screens (previously
it referenced a heading removed when entering the designer).

Eight existing studio UI/save tests pass, scoped ESLint passes, and whitespace
checks pass. This copy/accessibility change is not yet in the 3118 preview.

### Existing custom document and picker impact

On 3118, palette search reopened Book review persistence check. The editor and
look preview retained Author Ursula Le Guin, Rating 5 and the existing body and
source reference. No type was applied or document changed during this inspection.
The document picker exposes export but not import/revision/retirement. Folder
picker source wires import, duplicate and restore-version actions; retirement
currently exists in the store/MCP but no corresponding UI was found.

The document picker displayed zero items/folders using the current type because
it infers gallery entries without usage data. It now says Not available when
library usage data is absent, while the single-document apply impact receives
an explicit count of one. Four gallery lifecycle tests pass; scoped lint has
zero errors and two pre-existing editor warnings; whitespace checks pass. This
small display correction is not yet in the running preview.

### Custom-type retirement UI implemented

The folder look library now offers Retire type for custom types, with an
explanation that existing documents retain their content and appearance. Its
server action checks workspace ownership, rejects built-ins, scopes retirement
to the authorized blog and writes the existing retirement audit. It does not
rewrite documents or folder assignments. The picker reloads its library and
refreshes the workspace after success; errors remain visible in the preview.

Twelve folder-action/gallery tests pass, including owner/built-in/unavailable
checks and the audited operation; TypeScript and scoped ESLint pass, as do
whitespace checks. Browser retirement, removal from New and old-document
reopening remain to be verified in a fresh build. Port 3118 predates this work.

### Retirement integration failure found and fixed

On 3119 (61a23f79), retiring local Book review verification removed it from the
library (12 to 11 choices) and Home New. Reopening its existing document then
failed with Unknown built-in template book-review-verification-36cea4@1.
The pool only carried selectable types, so retiring one also removed the
renderer definition. The store itself still resolved the exact version.

Pools now carry pinnedTemplates separately from selectable templates. Server
pool/route construction batches only missing exact versions referenced by loaded
documents, Trash or folder defaults, scoped to the workspace. The rendering
index and selector include them; creation choices do not. This also covers
older immutable versions after type revisions. No query runs for an empty set.

The selector regression test, local Postgres lifecycle test (including another
workspace returning no definition), TypeScript, scoped lint and production build
pass. Fresh `.texttext/personal-build-pinned-types` serves 3120. Directly reopening
0ed70aa4-2854-4455-aba7-d8fdf9685bec now renders Book review with Author Ursula Le
Guin, Rating 5 and the unchanged body/source. Home New still lists only Note,
Article and Bookmark. Palette reopening from Home also retains Author. The
verification type remains retired in this local fixture. Temporary build configs
were removed after startup. No public release or installed-app update occurred.

### Full regression and folder rendering follow-up

At 1f35dfd1, `node scripts/with-local-database.mjs npm test` passed: 386 files,
3573 tests, with 17 files/123 tests skipped; 54.83 seconds. Log:
`/tmp/texttext-personal-current-full-tests.log`. Existing unrelated worktree
changes were present, as in earlier full runs. Database-gated tests are not
claimed by this default run; the lifecycle database check is recorded above.

Inspection found FolderPage still received only selectable definitions. Its
render-only availableTemplates input now gets a memoized combination of active
and pinned definitions. This preserves retired/historical folder layouts and
card rendering without adding them to creation controls. Two focused
folder/pinned-template tests, TypeScript, scoped lint and whitespace checks pass.
This final folder wiring change is newer than the full suite and 3120 preview.

### Laptop and wide desktop visual checks

Fresh production build at 77907e83 passed and runs at 3121 from
`.texttext/personal-build-layout-check`. Notes folder loads its seven items,
including the retired-type Book review, after the pinned rendering wiring.

CUA viewport checks: 1024x768 editor keeps left navigation, document and right
AI visible; the narrow rail truncates the assistant title and some folder names.
At 1600x1000, Notes shows its list with both rails, and Home centers the capture
and timeline column. Light and dark were visually inspected. Dark Home uses
black while the folder body uses charcoal beneath a black toolbar, a remaining
surface-consistency issue rather than full visual acceptance. These checks do
not prove all destinations or phone layouts. Viewport override was reset and
appearance restored to System. Temporary build config removed after startup.

### Folder color mismatch corrected

Computed DOM inspection on 3121 traced the dark folder's rgb(44,45,49) background
to `.post-folder-page` and its legacy folderhead tokens; its parent canvas was
already black. Artifact-scoped folder tokens now use the shared background,
surface, ink, muted, separator and accent values for both themes. Published
folder pages retain their own styling because the override is workspace-scoped.
The existing Artifact and folder-view tests pass; whitespace checks pass.
Visual verification requires a fresh build (3121 still has the old CSS).
Appearance was restored to System after the inspection.

### Folder palette cascade verified

Build f891e7c0 passed and runs at 3122, but actual dark-mode inspection showed
folder rgb(44,45,49) versus canvas rgb(0,0,0): the legacy dark selector tied the
new override and won by source order. Added the existing post-editor-content
ancestor to the workspace selector so it wins in both explicit and system themes.

For targeted browser verification, CDP temporarily changed that one loaded CSS
rule's selector to exactly the source correction. Dark folder and canvas both
computed rgb(0,0,0), and the screenshot showed a continuous black canvas with
legible rows. System/light then computed rgb(255,255,255) for both. Reload
removed the temporary CSS edit; appearance is System. Fifteen Artifact tests
pass and whitespace checks pass. The selector correction is not yet included
in the running 3122 build. Temporary TypeScript build configuration removed.

### Responsive build and bookmark filter contrast

Production build 91e51377 passed and runs at 3123. In the actual built app, dark
Notes folder and its canvas both compute rgb(0,0,0), closing the folder palette
cascade issue. At 390x844, Home capture and filters fit with mobile bottom
navigation and hidden desktop rails.

Dark Bookmarks exposed a white folder selector with nearly white text. Its CSS
used nonexistent --artifact-canvas and fell back to native Canvas. Changed to
--artifact-bg. A temporary edit of exactly that loaded rule verified black
background and rgb(242,242,242) text, with readable All folders in the screenshot.
Reload removed the temporary edit, the viewport was reset, and System appearance
restored. Fifteen Artifact tests and whitespace checks pass. The bookmark color
correction is newer than the running build. Build configuration was removed.

### Warm Home and News navigation measured

Local production 3123 (91e51377 implementation), 1280px desktop, visual-demo.
Twenty measured warm cycles after one excluded warm-up: Home p95 53.4ms
(range 29.8–55.2), News p95 51.0ms (range 32.5–61.1). Both meet the <200ms
warm-navigation target for this fixture. Start is capture-phase click; finish
is the animation frame after a destination content marker exists (Home timeline
row or first News row). This is DOM/frame readiness, not compositor or image
decode. No build was running. Automation call duration is excluded.

Home samples ms: 39.4,36.4,37,29.8,31.6,45.9,35.5,39,38.4,37,55.2,37.5,53.4,
51.7,32.2,50.7,50.7,36.8,34.6,36.2.
News samples ms: 34.8,39.6,34.5,33,39.1,34.1,36.2,34.2,36.4,32.5,37.5,51,
61.1,38,39.4,49.4,45.1,50.9,35.5,38.9.

An initial oversized automation batch timed out and was discarded. The measured
run used smaller batches with bounded listener/frame cleanup; temporary browser
measurement properties were deleted. Cold launch, large-workspace UI, article,
back, channel and folder timing remain distinct unfinished acceptance checks.

## Folder selection and mixed move destinations

Local browser verification found that focusing a note's row action button
selected the note and incorrectly replaced the folder with its editor. Returning
from an editor to that folder likewise kept the editor visible because the row
selection survived. Editor visibility now requires an edit view or an explicitly
opened note view; selection alone no longer hides the folder.

On localhost:3100, the corrected row menu remained open within Notes. The
Keyboard capture September 21 fixture (3cec53cf-6154-4571-b513-4e8b849ebb8f)
moved through the context menu to notes/mixed-workspace-check, survived a fresh
navigation, and retained its original title and body. Enter opened its editor;
activating the nested folder returned to the list with the note selected.

The context menu also retained an obsolete same-type destination filter. It now
offers all workspace folders for a nonempty selection, including mixed
selections. Live verification showed Blog, Notes, Bookmarks, feed subfolders and
Documentation as destinations for the selected note. Typecheck, targeted lint,
and 20 local-first/selection tests passed. Production-build verification remains
pending. The bookmarked fixture has not yet moved: the existing Bookmarks
collection opens its RSS reading surface, which needs investigation for access
to manual saved items before completing the mixed-folder round trip.

## Mixed folder and RSS content access

The folder renderer previously replaced personal items with the RSS surface
whenever feeds existed beneath a bookmark folder. Folders with feeds now expose
Items and News controls. Personal content defaults to Items when present; an
otherwise empty feed folder defaults to News. Feed detection no longer depends
on the parent folder's legacy mode. Create from News selects Items and focuses
the composer after it mounts.

In localhost:3100, the manual Texttext AI setup guide bookmark became visible
in Bookmarks and moved through its context menu into notes/mixed-workspace-check.
A fresh navigation showed that bookmark and Keyboard capture September 21
together. Cards selected by keyboard persisted across reload on that origin.
News retained the RSS list, and Create returned focus to Create an item.

Production build passed using local Postgres, with output in
.texttext/personal-build-folder-content; preview is localhost:3124. That build
also displayed both moved items after a fresh navigation and switched the
Bookmarks folder between its RSS list and item composer. Sixteen existing
folder-view/Artifact contract tests passed; targeted lint had no errors and one
pre-existing WindowedRows dependency warning. Build/typecheck passed.

Remaining: dark/narrow visual checks of the new control, persisted News/Items
preference, feed-folder moves and imported-item movement semantics. The manual
bookmark fixture displays a Saving date label despite surviving reopening;
investigate that status separately. This is not a release or complete acceptance.

## Folder content preference and truthful date metadata

Items/News now uses a folder-ID-scoped browser preference with a same-session
fallback when storage cannot be written. Storage events update other open tabs;
unknown values fall back to the folder's content-based default. In the current
localhost:3100 build, selecting Items and reloading preserved Items, and selecting
News and reloading preserved News. These are browser preferences, not account
settings synchronized across devices.

The manual bookmark's Saving label came from captureStatus=pending, which refers
to article extraction rather than whether the item was stored. Folder list rows
now show date metadata independently of capture state. The mixed folder displayed
SEP 21, 2026 for both stored fixtures, with no Saving label. Bookmark capture
controls still expose extraction state. Typecheck and 16 existing folder/Artifact
contract tests passed; lint passed with the existing WindowedRows warning.
These changes are verified in development; the production preview on 3124 still
contains the preceding build. Dark/narrow checks, feed-folder moves and imported
item movement remain open.

## Moving RSS folder subtrees

Added an owner-only Move to control to sidebar folder menus. The store operation
locks the workspace folder rows, validates the destination, and updates subtree
paths and the moved root's parent in one audited statement. IDs, descendant
parent IDs, templates, items and feed connections are preserved. The built-in
blog/notes/bookmarks roots cannot move. Cycles, unavailable destinations and
collisions are rejected; user folders can move to the workspace root.

Eight local Postgres home tests passed, including a new RSS subtree scenario
with a nested note, nonempty imported article set, unchanged subscription,
audit verification, cycle/collision rejection and moving to root. Typecheck
passed; targeted lint had no errors (three existing store warnings).

Live development UI on localhost:3100 moved NASA from bookmarks/nasa to
notes/mixed-workspace-check/nasa. The sidebar updated, the moved folder showed
one source and ten articles, and its list survived reload. The notes-mode parent
Mixed workspace check also exposed those articles through News. The source
remains at this new path in the local visual-demo fixture. Production build,
shared agent-command exposure, URL-alias behavior and broader permission cases
remain to be verified before complete acceptance.

## Shared folder move command

The workspace tool catalog now includes move_folder with folder_id and a nullable
parent_folder_id. The MCP adapter requires workspace ownership and calls the same
audited store operation as the sidebar action. The assistant adapter refreshes
the pool after success so descendant paths and feed source locations update
together. The command is available through the existing authenticated command
transport; no app-to-MCP loopback was introduced.

Ninety-two tool schema/access/MCP tests passed, including a new test proving the
store receives an external-agent audit and a non-owner cannot invoke the move.
Fifty-four assistant/transport/CLI tests passed. Typecheck passed; targeted lint
had no errors and one existing unused declaration warning. An actual AI-driven
move and production build verification remain open.

## Integrated suite after folder commands

At 33e010a1, the full default suite completed in 120.26 seconds: 385 files
passed, one failed, 17 skipped; 3,574 tests passed, one failed, 124 skipped.
The sole failure was the existing batch4 source contract expecting the folder
count to use all items. The Items/News split intentionally counts personalItems
in the Items view. Updated that assertion and retained a check for the content
switch; all nine tests in the affected file then passed. No runtime code changed
for this test correction. Logs: /tmp/texttext-integrated-current-tests.log and
/tmp/texttext-ui-contract-fixed.log. Skipped database/native tests are not
covered by this run.

The next organization gap is confirmed in source: moving an imported article
does not add a retention hold, the pool excludes feed-origin posts after reload,
and FolderPage excludes them from Items. The solution must preserve source
provenance while making deliberate filing durable and visible; changing only
the folder renderer would leave both reload and expiry behavior incorrect.

## Filed RSS desktop workflow and production build

On September 21, verified the NASA Mars article
“NASA Discovery Reveals Complex Water Systems on Early Mars”
(`5caed3c9-3566-4c9a-9e8a-f7f45134cc7b`) through the desktop command palette.
Moved it into `notes/mixed-workspace-check`. Items showed three entries: the
NASA article, Texttext AI setup guide, and Keyboard capture September 21. A
full reload retained all three. Bookmarks displayed the NASA preview and its
new folder. The News tab excluded the personal note and manual bookmark and
reported ten RSS articles; the filed NASA article retained NASA attribution
and showed “Saved by you”. Both desktop rails remained visible.

This exposed and fixed two integration problems: command-palette moves still
filtered destinations by legacy folder mode, and News queried all content in
a mixed subtree. Moves now offer all folder modes, refresh the saved item's
filing metadata, and News requests a server-enforced feed-origin scope with
matching counts. Related command and local Postgres tests pass (22 tests),
TypeScript passes, and lint reports no issues in the changed files.

Production build succeeds using `.texttext/personal-build-filed`, deployment
`personal-filed`, with local Postgres. Preview is running on port 3125. In this
fresh production preview, Home's Saved filter includes the NASA article and
its saved event, the mixed folder has all three Items, and News has ten RSS
articles. The older port-3100 development process omitted the new timeline
entry despite the current store query returning it; use 3125 for acceptance.
Native installation and public release remain unchanged.

## Personal quota and current regression checks

The integrated default suite at `b28a6876` passed 386 files / 3,576 tests,
with 17 files skipped. The separate local Postgres template lifecycle test
also passed: immutable versions, retirement, pinned rendering definitions,
and cross-workspace textpack import preserve the original document.

Production UI authoring created `Reading review lifecycle` manually with
Genre, Author and numeric Rating fields and a Cards collection view. Creating
its first document exposed an unrelated quota bug: `visual-demo` had 473 total
items but only 20 authored or deliberately saved items. Creation compared all
473 against the personal limit of 200, despite RSS already having a separate
`maxFeedItems` limit. The editor now uses a personal-content count that excludes
unsaved RSS imports and includes kept/filed imports. Limit enforcement remains.

The quota regression tests pass (17 tests, including local Postgres); TypeScript
and lint pass (two existing unused-symbol warnings). The full default suite
passes again: 386 files / 3,576 tests, 17 files and 127 tests skipped. Opt-in
checks are recorded separately, not inferred from this default run.

The production build `.texttext/personal-build-quota` passes and runs on 3126
with deployment `personal-quota`. On that build, a custom review was created
and saved with title “The Left Hand of Darkness”, author “Ursula K. Le Guin”,
rating 5 and body “A review kept with its original type version.” The persisted
item ID is `0375e130-6f69-4382-955b-e8cc3844a520`. The earlier failed local draft
remains open on port 3125; it was not discarded. The type definition is saved,
but complete UI version-edit and export/import checks remain open: the gallery
exposes Export, but the browser download observation timed out, so export was
not accepted as verified. Manual starter-content/default authoring also needs
an explicit UI audit rather than relying on the underlying template schema.
After a full reload on 3126, the review body, Author and Rating fields retained
the exact values above; document status was Saved and assistant status Synced.

## Custom starter content and defaults

Custom definitions now carry optional validated `starter` data: title, Markdown
body and scalar field defaults. The manual designer exposes these values and
previews them. Both server creation paths and instant local drafts use the same
initializer. Explicit initial text wins; imported canonical documents bypass
initialization. Reopening/version updates never reseed existing documents.

Four affected test files pass (40 tests), including local Postgres creation,
explicit-text precedence, cross-workspace textpack preservation, optimistic
creation/early edits and invalid-default rejection. TypeScript and lint pass
(two existing unused-symbol warnings). The full default run finished with
385 files / 3,579 tests passing and one failure: the new `starter` schema key
needed documentation. Added it to `docs/render-spec.md`; all 105 tests in that
failed file then passed. No runtime changes followed that run. Seventeen
opt-in files remained skipped.

Production build `.texttext/personal-build-starter` passes and runs on port
3127, deployment `personal-starter`. Manually saved “Review with starter” with
starting title “Book review”, Topic “Ideas”, and Markdown body containing
“## Summary” and “## What stayed with me”. Creating from the Home menu on 3127
produced item `d0690ff9-20e7-442b-a858-7187d685d22d`. After full reload, its title,
both headings and Topic value `ideas` remained, with Saved and Synced status.

This closes creation with manual starter content/basic defaults. Full UI
version-edit/export/import, responsive/theme coverage and the other plan gates
remain open. The installed native app and public release are unchanged.

## Saved type editing entry point

The designer now offers saved custom types even when no folder uses them.
It loads the latest editable blueprint and defaults to This version only,
with existing-item migration off. Duplicate pinned definitions appear once;
built-in definitions are excluded. Missing authoring source is reported rather
than reconstructed lossily.

On development preview 3100, opened Review with starter from this picker,
changed its starting title to Reading reflection, and saved. The UI reported
Saved version 2 and No folders were changed. Reopened existing document
`d0690ff9-20e7-442b-a858-7187d685d22d` through a full page navigation: its title
remained Book review, Topic remained Ideas, both original body headings were
present, and status was Saved/Synced. This verifies the existing-item content
invariant for this version-only change, not every migration or imported type.

Two affected test files pass (13 tests); TypeScript passes; lint has no errors
and 17 existing shell warnings. Logs: `/tmp/texttext-edit-type-tests.log`,
`/tmp/texttext-edit-type-tsc.log`, `/tmp/texttext-edit-type-lint.log`.
A new production build and export/import UI acceptance remain outstanding.

## Custom type export and import through the UI

On development preview 3100, exported Review with starter version 2 from the
item look gallery. The browser download-event observer timed out, but the
actual file `/Users/shokunin/Downloads/review-with-starter.texttext-look.json`
was present and contained the version-2 starter title, body and field defaults.
The previous observer timeout is not evidence of a failed export.

Opened Notes > Change look > Import, selected that exact downloaded file, and
verified the schema-validated import preview showed Reading reflection, Topic
Ideas, Summary and What stayed with me. Save as new returned an independent
My look with zero item and folder usages and the same preview. Did not apply
it to the eight existing folder items. This verifies the UI export/import
round trip of render definition and starter data on the development build.
Authoring blueprints are not part of the look export, so imported definitions
currently cannot be reopened in the manual designer; this remains a functional
limitation to resolve. Production acceptance remains outstanding.

## Portable editable type source

Look exports now fetch the exact selected version and include its validated
blueprint source as an optional sibling of the rendering definition. Both
editor and folder galleries use the owner-authorized export action. Imports
preserve that source only when its current compiler reproduces the definition
exactly; mismatched or incompatible source is rejected. Older definition-only
files still import, but cannot regain source that was never exported.

Twenty-two tests across four files pass, including local Postgres verification
of exact old-version source retrieval and a cross-workspace import under a new
identity that remains editable. TypeScript passes and lint has four existing
warnings, no errors. Logs: `/tmp/texttext-portable-source-{tests,db-tests,tsc,lint}.log`.
The new source-bearing export/import path still needs browser and production
verification; the preceding browser receipt exercised the older format.

## Folder defaults no longer migrate existing documents

Removed the folder picker's unconditional bulk migration and its partial-batch
retry handling. Choosing a default leaves existing document types unchanged;
server migration now requires literal true. Sidebar actions distinguish Choose
default type from Edit default type. Folder collection presentation still uses
the selected definition; separating that configuration remains in the plan.

Twenty-two tests across the action, entry-point and gallery suites pass,
including omitted/null/false/string migration inputs preserving existing items.
The source-preserving import changes also passed 22 targeted/database tests.
Browser acceptance of these latest changes remains outstanding.
