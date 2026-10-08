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

Mac 1193 and Windows builds are in progress from this same source. Neither
installed client has been replaced yet. The Windows installed process remains
running; normal save/close has been requested before replacement. The existing
changelog is absent from the signed-in CLI search and the inspected TextText
iCloud/Documents paths; no duplicate has been created. No public desktop release.
