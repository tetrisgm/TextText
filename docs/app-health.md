# App-owned reliability

Write carries its reliability system inside the shipped product. Each release
proves its source gates, each installed version checks its production
integrations, and reports can be reviewed without collecting document content.

## Lifecycle

1. `release/ship.sh` runs TypeScript, web unit tests, Swift unit tests, the Next
   production build, and the Apple acceptance matrix.
2. The ship process writes a build attestation containing stable suite IDs,
   source commit, version, and build.
3. The receipt is copied into the app before code signing.
4. The staged app runs `releaseVerification`. A failed check blocks publishing.
5. The installed app runs on the first launch of each version. An app-owned
   hourly scheduler runs the next report when the daily interval becomes due,
   even if the app remains open in the background.
6. Every report is written locally first. Authenticated upload is best-effort.
7. Pending reports remain in a bounded queue and retry later.
8. The ship command installs the release, waits for that exact version and
   build to write and upload a report, then reviews it before declaring the
   release complete.

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
only.

Review recent reports:

```sh
npm run health:review
npm run health:review -- --version 0.70
npm run health:review -- --version 0.70 --build 75 --wait-seconds 30 --require-reports
npm run health:review -- --limit 500 --json
```

The command summarizes report count, version, build, status, trigger, check
pass rate, p95 duration, and maximum duration. It does not print user IDs,
installation IDs, report payloads, filenames, paths, URLs, or content.

## Adding a check

1. Choose a stable dotted ID and stable numeric metric keys.
2. Exercise production code with a deterministic content-blind fixture.
3. Keep the check fast and independent of the web view.
4. Add a focused unit test and include the ID in staged-app verification when
   it is release-critical.
5. Add the equivalent reusable primitive or contract to `~/dev/stack/mac-kit`.

Do not put full XCTest or Vitest runners inside the production app. Full suites
remain ship gates and are represented by the signed build attestation. Runtime
self-tests cover the small set of production integrations that can drift after
installation.
