# Apple Platform Evals

This is the verification layer for the Apple platform plan
(docs/apple-platform-plan.md). It answers one question on demand: is the plan
still satisfied, phase by phase and invariant by invariant. Three eval layers
sit on top of the ordinary regression tests, and one runner ties them into a
single green/red gate.

## Run it

```sh
mac/scripts/apple-plan-eval.sh
```

That runs the full Swift suite, then checks one concrete condition per plan
exit criterion, per privacy invariant, and per explicit non-goal, and prints
an acceptance matrix. It exits non-zero if any row fails. It touches no
network, no real iCloud Drive, and no real workspace. To run only the eval
suites:

```sh
swift test --package-path mac --filter WritingToolsProtectionEvalTests
swift test --package-path mac --filter IntentBehaviorGoldenEvalTests
swift test --package-path mac --filter WorkspaceSpotlightIndexerTests
```

## The three layers

### 1. AI-behavior golden evals

Pin the behavior of the intelligent surfaces of the Apple platform, each as a
named case so a single regression is caught by name.

- `IntentBehaviorGoldenEvalTests` (WriteAppIntentsTests) has one golden case
  per App Intent: create, open (returns the `write-app://` deep link the app
  opens), append (preserves the existing body), search, create folder, move,
  create bookmark (URL lands in the `links:` list the server round-trips),
  publish (blog kinds only), publish-refuses-note, unpublish, recent.
- `WritingToolsProtectionEvalTests` (WriteEditorTests) pins the Writing Tools
  contract: prose is rewritable, but fenced code, inline code, tilde fences,
  and unclosed fences are protected ranges, backticks inside a fence are not
  double-counted, and the protected spans are clipped to the rewrite
  selection.
- `WorkspaceSpotlightIndexerTests` (WriteSpotlightTests) pins the Spotlight
  mapping: front matter to attributes, the `write-app://` deep link, machine
  keys (`writeId`, `schema`) never becoming searchable content, and an
  evicted file indexing from metadata without forcing a download.

### 2. Data-safety / invariant evals

The privacy and data-loss invariants, mostly already the sync engine's
regression suite, surfaced here as named acceptance rows.

- `SyncEngineRegressionTests` (WriteTests): the mass-delete circuit breaker,
  the mirror-id era guard, ENOENT-only deletes, the `.icloud` eviction guard,
  the published-URL round-trip, the unreachable-backend safety, migration
  adoption, and mtime stability.
- `WriteShareCoreTests`: the inbox never loses an item (payload-first ordering,
  a corrupt sidecar is skipped not wedged), append preserves the body, and the
  Quick Look renderer escapes all content, loads no remote or `file://`
  resources, and hides machine front matter.
- `EditorDocumentTests`: front matter round-trips byte-for-byte, canonical
  quoted titles decode without double-encoding, an unseen external write is
  preserved as a conflicted copy, and the editor follows sync-engine renames.

Privacy invariants enforced: notes and bookmarks are unlisted forever
(refused at the App Intents layer, force-drafted server side), a bookmark's
URL survives sync (it must be in `links:`, never a `url:` scalar the server
drops), and evicted iCloud files never become server deletes.

### 3. Acceptance evals vs the plan

`mac/scripts/apple-plan-eval.sh` maps each item below to a concrete check.
Structural checks (a file, a target, a registered scheme) confirm the phase
is wired; the test run confirms it behaves.

| Row | What it asserts |
| --- | --- |
| tests | The whole Swift suite is green |
| suite:* | Each named eval suite exists and is wired in |
| p1.layout / p1.identity / p1.local-state | Canonical folder layout, plain-text identity front matter, device-local state kept out of iCloud |
| p2.textkit / p2.writingtools | TextKit 2 editor, Writing Tools behind availability |
| p3.manifest / p3.generator / p3.deeplink | Capability manifest, generator, `write-app://` scheme |
| p4.inbox / p4.quicklook / p4.appex-sources | Inbox contract, Quick Look renderer, extension sources |
| p5.ifmatch / p5.offline | If-Match conflict rules, mass-delete breaker so backend failure never mutates local files |
| inv.unlisted / inv.bookmark-links / inv.eviction | Publishing refuses unlisted kinds, bookmark URL in `links:`, eviction never deletes |
| nongoal.fileprovider / nongoal.cloudkit | File Provider removed, no CloudKit document storage |
| style.no-em-dash | No em dashes in the Apple docs |

## What the evals have already caught

Writing evals is not a formality here. The App Intents golden case for
bookmarks caught a real defect: `createBookmark` was writing the URL as a
`url:` front matter scalar, which the server parser drops (it reads bookmark
URLs only from `links:`), so an intent-created bookmark would have synced with
no link. The eval failed against the shipped code; the fix emits the `links:`
list the server round-trips. The identical defect had been fixed in the Share
extension's filer during its review; the eval proved the App Intents path had
the same bug.

## Extending

- A new intent, editor behavior, or Spotlight mapping gets a golden case in
  the matching `*EvalTests` file.
- A new invariant gets a `check` row in `mac/scripts/apple-plan-eval.sh` and,
  where it is behavioral, a test.
- A new phase or exit criterion gets a `p<N>.*` row in the runner.

Keep every eval hermetic: temporary directories only, no network, no real
iCloud Drive, no real workspace. The sync-safety evals in particular exist
because a smoke that ran the engine against a real workspace once soft-deleted
it; evals must never do that.
