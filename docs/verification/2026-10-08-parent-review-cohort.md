# Parent selection and proposal review candidate

Frozen source `8621dd0c`, clean candidate
`/private/tmp/texttext-candidate-JP7DCB`.

- Exact-source core gate: 759 tests in 78 files and TypeScript passed.
- Exact-source native gate passed all required sync, shared editing, recovery,
  device state, HTTP, session lifecycle, connection, collaboration, creation and
  remote store suites. Both receipts match this candidate.
- Proposal review: 16 focused tests passed. Internal arguments are collapsed;
  completion, dismissal, expiration, execution and failure use readable outcomes.
  Approval still rechecks the signed-in owner and uses the stored proposal ID.
- Note browser flows passed: save/insert a TextPack text template, finish/reopen,
  light/dark rendering, stable parent selection, retained unavailable parents,
  reference navigation callback, removal and Escape focus. This is not a complete
  Supernotes fidelity or live Safari parent-editing certification.
- The verification fingerprint now covers binary built-in presets and their
  generator inputs; every gate also checks generated modules for drift.

Logs: `/tmp/texttext-candidate-8621dd0c-sync.log`,
`/tmp/texttext-candidate-8621dd0c-review.log`,
`/tmp/texttext-candidate-8621dd0c-note-browser.log`.

The initial Oracle build refused an out-of-root dependency symlink before
contacting production. A lockfile dependency installation replaced only that
candidate symlink. Deployment resumed through the web-only workflow; its log is
`/tmp/texttext-oracle-8621dd0c-deploy-resume.log`.

Oracle now serves `texttext-oracle-20261008T102758Z-8621dd0c`. All thirteen live
checks passed; the previous release remains available. Backup
`texttext-20261008T102936Z-149ff735.dump` preceded migrations. TextText and all
three Algorave units remain active; shared proxy/runtime configuration mtimes
are unchanged. Actual Safari refresh and screenshot show `Change applied.` and
collapsed technical details on the completed verification proposal.

Windows passed native core/agent suites, 299 shared-client tests, TypeScript,
publish and actual desktop/editor/close smoke. Candidate:
`C:\Users\Shokunin\dev\texttext-build-8621dd0c\windows\build\candidate-14d6cf21a6454631b580ab58ee7acad8`.
Smoke receipts:
`C:\Users\Shokunin\dev\texttext-build-8621dd0c\windows\build\smoke-receipts-12d18a40d3f7408781be0f9a4771bf41`.
Log: `/tmp/texttext-windows-8621dd0c-build.log`.

Mac `/Applications/TextText.app` is now **0.204 (1193)** from this source.
Signed arm64 app and three extensions passed installer verification. The local
Store sandbox exception leaves the automatic runtime-health report unverified;
actual UI startup preserved the signed-in identity, iCloud root and existing
verification note. Search found and reopened that same note. A dedicated test
append survived normal quit/reopen; disk inspection finds both the new
`Mac save and reopen verification 1193.` and prior native marker exactly once.
All prior verification text remains visible. A native selection test initially
landed inside the last line; Undo restored it before the successful end-of-body
append. The first UI observation after relaunch timed out; the running process
and subsequent UI observation confirmed startup and saved content.

The first Mac build used the installed sandbox-signed helper as its runtime
input and stopped when executing it outside the sandbox. Resuming with the
original installed Codex runtime passed; both versions are `codex-cli 0.153.4`.
Logs: `/tmp/texttext-mac1193-build-resume.log` and
`/tmp/texttext-mac1193-install.log`. New parent-specific live acceptance and
extensions' full interactive acceptance remain pending.

The Windows installed process remains
running; normal save/close has been requested before replacement. The existing
changelog is absent from the signed-in CLI search and the inspected TextText
iCloud/Documents paths; no duplicate has been created. No public desktop release.
