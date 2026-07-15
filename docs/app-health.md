# App-owned reliability

Write carries its reliability system inside the shipped product. Each release
proves its source gates, each installed version checks its production
integrations, and reports can be reviewed without collecting document content.

## Lifecycle

1. `release/ship.sh` runs TypeScript, web unit tests, Swift unit tests, the Next
   production build, the Apple acceptance matrix, and the deterministic
   workflow capability evaluator.
2. The ship process writes a build attestation containing stable suite IDs,
   workflow receipts, source commit, version, and build.
3. The receipt is copied into the app before code signing.
4. The staged app runs `releaseVerification`. Any non-passing check blocks
   publishing.
   The isolated verifier seeds an empty sync index and a healthy local Finder
   fixture because it has no registered File Provider domain; extension
   embedding and the real Finder lifecycle are covered by separate checks and
   the deterministic soak. Every staged check must still return `pass`.
5. The installed app runs on the first launch of each version. An app-owned
   hourly scheduler runs the next report when the daily interval becomes due,
   even if the app remains open in the background.
6. Every report is written locally first. Authenticated upload is best-effort.
7. Pending reports remain in a bounded queue and retry later.
8. The ship command installs the release, waits for that exact version and
   build to write and upload a report, then runs the fail-closed release review
   before declaring the release complete.

Finder reliability has two complementary gates. The Swift suite runs a
deterministic 20-cycle lifecycle through the real File Provider extension core:
create, edit, rename, move, offline retry, delete, restore, relaunch, and fetch.
The installed app also samples File Provider readiness for a bounded five-second
window so the initial `checking` state can settle without hiding persistent
pending work or provider failures. Runtime reports expose only sample counts and
stable state flags.

Web-owned workflows use signed capability receipts rather than production
mutation probes. `mac/scripts/verify-workflow-capabilities.sh` evaluates the
typed command schemas, scope requirements, confirmation semantics, and
content-blind fixtures for these required IDs:

- `workflow.folder_trash_restore`
- `workflow.sharing_access`
- `workflow.comments`
- `workflow.bookmark_recapture`
- `workflow.cover_assets`

The evaluator writes only source identity, stable IDs, and pass status. The
build attestation refuses a missing, stale, duplicate, incomplete, or
non-passing receipt. Installed health validates each embedded receipt under its
own check ID. It never trashes or restores folders, changes access, creates a
comment, recaptures a bookmark, or changes an asset in a person's workspace.

The release also has one architecture identity from build through update. The
Write executable and its three extensions must be arm64-only, while Sparkle is
left universal. The staged and public appcasts must advertise
`sparkle:hardwareRequirements` as `arm64`; a missing marker blocks publishing
or completion of the owner ship command.

This follows the useful PartyParty pattern of a bounded local history, lifecycle
probes, best-effort upload, and centralized review. Write uses a structured,
content-blind report instead of an unstructured session log because document
privacy is a product invariant.

## Local evidence

Reports live under the app's private state directory:

```text
health/
  latest.json
  history/<report-id>.json
  pending/<report-id>.json
  state.json
```

Directories use mode `0700`; files use `0600`. History keeps 30 reports and the
pending queue keeps 10. An offline or failed submission never discards the
local report.

## Upload and review

The app posts to `/api/app/health` with its normal scoped sync bearer. The
server validates a strict schema and stores the report in
`app_health_reports`. The channel accepts stable check IDs and numeric metrics
only. Release/build values and the OS version are restricted to release-safe
characters, and duplicate check IDs are rejected. Reports are accepted only
after persistence succeeds and then return `rollupAvailable: true`; storage
failures return `503` with `accepted: false` so the app retains and retries the
queued report. The dynamic rollup reads the same table after the insert
completes, so there is no separate summary row that can become stale.

Rollup queries select only app identifier, version, build, trigger, status,
receipt time, and the structured `checks` array. They do not select user IDs,
installation IDs, OS strings, or full report JSON. Rollup output also drops
numeric metrics. It contains aggregate counts, pass rates, timing percentiles,
stable check IDs, and stable alert codes only.

Review recent reports:

```sh
npm run health:review
npm run health:review -- --version 0.70
npm run health:review -- --version 0.70 --build 75 --wait-seconds 30 --require-reports
npm run health:review -- --app-identifier net.writeapp.write.mac --version 0.70 --build 75 --json
npm run health:review -- --limit 500 --json
```

The command summarizes report count, version, build, status, trigger, check
pass rate, p95 duration, and maximum duration. It does not print user IDs,
installation IDs, report payloads, numeric metrics, filenames, paths, URLs,
content, free-form errors, or database exception details.

Supplying both `--version` and `--build` activates release mode. Release mode
always fails closed; `--require-reports` and `--fail-on-failure` remain accepted
for compatibility with existing ship commands but are not required. The owner
release gate requires the exact cohort's aggregate status to be `pass`; an
otherwise non-blocking `warning` fails this CLI gate. JSON output includes
`releaseGate.requiredStatus`, `releaseGate.passed`, and stable
`releaseGate.blockingCodes`. Exit code `2` means the exact release is missing.
Exit code `3` means the release is failed, regressed, or warning-only. Invalid
arguments, missing database configuration, query errors, and malformed stored
exact-release rows exit `1` or block the release. Stderr uses stable machine
codes such as `APP_HEALTH_EXACT_RELEASE_MISSING` and
`APP_HEALTH_EXACT_RELEASE_NOT_PASS` rather than raw errors.

## Automatic triage

An exact release evaluation produces `releaseReady`, `status`, `reportCount`,
`summaries`, and an `alerts` array. Alerts use stable codes and have
`severity: "blocking"`:

- `exact_release_missing`: no accepted report matches the requested version
  and build.
- `invalid_exact_release_report`: a matching stored row cannot satisfy the
  strict rollup schema.
- `report_failed`: one or more matching reports have overall status `fail`.
- `check_failed`: a named check failed, even if its enclosing report claims
  another status.
- `report_pass_rate_regression`: the release report pass rate regressed.
- `check_pass_rate_regression`: a named check pass rate regressed.

A pass-rate drop is blocking when all three conditions hold: the current
cohort has at least 5 reports, the prior baseline has at least 20 reports, and
the pass rate drops by at least 10 percentage points with a two-proportion
z-score of at least 1.96. The baseline is the most recent 200 reports for the
same app received before the first report for the target release. Report and
per-check rates are evaluated independently. Warnings remain visible but do
not block the broader cohort evaluation unless they produce a significant
pass-rate regression.

The production machine endpoint is:

```text
GET /api/app/health/status?version=<version>&build=<build>
GET /api/app/health/status?appIdentifier=<id>&version=<version>&build=<build>
```

Set `APP_HEALTH_REVIEW_TOKEN` to a random value of at least 32 characters and
send it as a bearer token. The route is uncached. It returns `200` only when the
exact release is ready and `503` for missing reports, blocking alerts, missing
database access, or missing review-token configuration. Invalid targets return
`400`; invalid credentials return `401`. Every response is machine-readable,
and operational failures use enumerated codes without exception text.

The endpoint and owner CLI deliberately answer different policy questions.
The endpoint reports cohort health and can return `200` with `status: "warning"`
and `releaseReady: true` when no blocking alert exists. The exact version/build
CLI used by `release/ship.sh` applies the stricter owner gate and exits nonzero
for that same warning. Both consume the same content-blind summaries; neither
loads or emits document content or installation identity.

The existing app-health migration creates release/build and receipt-time
indexes used by these live rollups. No rollup table or additional identifiers
are stored.

## Adding a check

1. Choose a stable dotted ID and stable numeric metric keys.
2. Exercise production code with a deterministic content-blind fixture, or
   use a signed capability receipt when a safe runtime probe would mutate
   production state.
3. Keep the check fast and independent of the web view.
4. Add a focused unit test and include the ID in staged-app verification when
   it is release-critical.
5. Add the equivalent reusable primitive or contract to `~/dev/stack/mac-kit`.

Do not put full XCTest or Vitest runners inside the production app. Full suites
remain ship gates and are represented by the signed build attestation. Runtime
self-tests cover the small set of production integrations that can drift after
installation.
