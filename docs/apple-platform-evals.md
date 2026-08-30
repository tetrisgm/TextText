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

`--skip-tests` means the exact source fingerprint already completed the suite.
The owner-facing ship command refuses an independent `--skip-tests` release
unless `.texttext/release-gate-receipt.json` matches the current commit, source
state, required commands, and passing statuses.

After TypeScript, web unit, Swift unit, live on-device assistant, and Apple
acceptance gates pass, `mac/scripts/verify-workflow-capabilities.sh` evaluates the five web-owned
workflow command classes without executing a production mutation. Then
`mac/scripts/texttext-build-attestation.sh` records their stable receipt IDs with
the source suites, durations, source commit, app version, and build number. The
real Vercel production build runs once later, after the immutable Mac artifact
has established the release marker. `build-app.sh`
embeds the receipt as
`Contents/Resources/AppHealthBuildAttestation.json` before signing.

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
- `workflow.folder_trash_restore`: the signed command contract preserves soft
  deletion, restoration, confirmation, and no permanent delete input.
- `workflow.sharing_access`: list, grant, role change, and revoke contracts keep
  scope and audience-changing confirmation requirements.
- `workflow.comments`: list, add, and resolve contracts validate bounded,
  content-blind comment and anchor fixtures.
- `workflow.bookmark_recapture`: recapture is a scoped open-world write that
  accepts only the saved bookmark identity and concurrency token.
- `workflow.cover_assets`: list, import, remove, and cover contracts retain
  media placement, URL, confirmation, and concurrency constraints.
- `state.persistence`: private local state is writable with restricted modes.
- `workspace.storage`: the local workspace is readable and writable.
- `finder.provider`: Finder integration reports a healthy, working, or failed
  native status.

The direct self-tests invoke real production codecs and mappers. The workflow
checks validate source-matched signed receipts from typed command definitions.
Both use deterministic fixtures, duplicate no mutation logic, and never touch a
person's documents.

## Apple silicon release gate

`build-app.sh` builds TextText explicitly for arm64. The reusable staged-bundle
check verifies the main executable and the Share, Quick Look, and File Provider
extensions contain only the arm64 slice. Sparkle remains universal because its
framework and update helpers do not need to be thinned.

Sparkle infers
`<sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>` from the
main executable. `mac/scripts/release.sh` checks that marker before upload,
`scripts/publish-mac-release.mjs` refuses an appcast without it, and
`release/ship.sh` requires it from the deployed public appcast. The installed
bundle is checked again after replacement. WKWebView's desktop compatibility
user agent intentionally retains its Intel token and is not an executable
architecture claim.

## Named regression suites

The Swift suite retains detailed behavioral coverage:

- `IntentBehaviorGoldenEvalTests`
- `WorkspaceSpotlightIndexerTests`
- `TextTextShareCoreTests`
- `WorkspaceEnumeratorTests`
- `TextTextItemMapperTests`
- `BridgeTests`
- `EnumeratorAdapterTests`
- `FileProviderExtensionTests`

The acceptance matrix also checks the canonical folder layout, capability
generation, App Intents metadata, deep links, Share and Quick Look extensions,
optimistic local-write safety, publishing privacy, eager File Provider
materialization, health wiring, and the absence of CloudKit document storage.

## Safety rules

- Use temporary directories only. Never point an eval at a real workspace.
- Reports contain stable IDs, status values, durations, and numeric metrics.
- Never report document text, titles, filenames, paths, URLs, credentials,
  installation identifiers in review output, or free-form errors.
- Store locally before upload. Network failure cannot block launch, editing,
  navigation, Finder sync, or optimistic client state.
- Health work runs outside the web view and never reloads it.
- Daily health must not perform destructive or externally visible production
  mutations. Use a source-matched capability receipt for those workflows.

Add a regression test for every behavioral defect and a runtime self-test only
when a short deterministic probe can detect a production integration failure.
