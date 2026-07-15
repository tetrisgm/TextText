# Apple platform evals

The Apple verification layer answers two questions:

1. Did the full source tree pass its unit, build, and acceptance gates before
   this app was signed?
2. Do the important production paths still work on this installed Mac?

The owner-facing ship command handles both automatically. Agents should review
the resulting reports before inventing manual reproduction work.

## Release gate

```sh
mac/scripts/apple-plan-eval.sh
```

The command runs the full Swift suite and a structural acceptance matrix. The
outer `release/ship.sh` already ran Swift tests, so it uses:

```sh
mac/scripts/apple-plan-eval.sh --skip-tests
```

`--skip-tests` means the same ship process already completed the suite. The
owner-facing ship command refuses an independent `--skip-tests` release unless
`WRITE_RELEASE_GATES_VERIFIED=1` is explicitly supplied by a trusted outer
workflow.

After TypeScript, web unit, Swift unit, Next build, and Apple acceptance gates
pass, `mac/scripts/write-build-attestation.sh` records their stable suite IDs,
source commit, app version, and build number. `build-app.sh` embeds the receipt
as `Contents/Resources/AppHealthBuildAttestation.json` before signing.

The staged app then runs its own `releaseVerification` health suite.
`build.attestation` fails when the receipt is missing, when a suite is not
marked pass, or when the bundle version or build differs from the receipt.

## Installed runtime evals

The installed app runs the same content-blind suite on first launch of every
version, daily, and on demand. The production-safe unit-style checks include:

- `bundle.release`: bundle identity, HTTPS Sparkle feed, and EdDSA public key.
- `build.attestation`: source and release-gate receipt matches the running app.
- `bundle.extensions`: Share, Quick Look, and File Provider extensions exist.
- `selftest.markdown_identity`: identity front matter inject, extract, and strip
  round trip.
- `selftest.filename_codec`: unsupported filename characters such as `?`, `/`,
  and `:` encode portably and decode to the exact title.
- `selftest.document_assets`: canonical asset URLs localize into TextBundle
  paths and restore without loss.
- `selftest.public_link`: public Finder actions never expose the authenticated
  sync transport URL.
- `state.persistence`: private local state is writable with restricted modes.
- `sync.index`: the local sync index is decodable.
- `workspace.storage`: the local workspace is readable and writable.
- `finder.provider`: Finder integration reports a healthy, working, or failed
  native status.

These tests invoke real production codecs and mappers with deterministic
fixtures. They do not duplicate implementation logic and they never touch a
person's documents.

## Named regression suites

The Swift suite retains detailed behavioral coverage:

- `WritingToolsProtectionEvalTests`
- `IntentBehaviorGoldenEvalTests`
- `WorkspaceSpotlightIndexerTests`
- `SyncEngineRegressionTests`
- `WriteShareCoreTests`
- `EditorDocumentTests`
- `WorkspaceEnumeratorTests`
- `WriteItemMapperTests`
- `BridgeTests`
- `EnumeratorAdapterTests`
- `FileProviderExtensionTests`

The acceptance matrix also checks the canonical folder layout, TextKit editor,
Writing Tools, capability generation, App Intents metadata, deep links, Share
and Quick Look extensions, optimistic local-write safety, publishing privacy,
eager File Provider materialization, health wiring, and the absence of CloudKit
document storage.

## Safety rules

- Use temporary directories only. Never point an eval at a real workspace.
- Reports contain stable IDs, status values, durations, and numeric metrics.
- Never report document text, titles, filenames, paths, URLs, credentials,
  installation identifiers in review output, or free-form errors.
- Store locally before upload. Network failure cannot block launch, editing,
  navigation, Finder sync, or optimistic client state.
- Health work runs outside the web view and never reloads it.

Add a regression test for every behavioral defect and a runtime self-test only
when a short deterministic probe can detect a production integration failure.
