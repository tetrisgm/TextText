# Template cohort 1190 acceptance

Candidate source: `5254ff85`, clean clone `/private/tmp/texttext-shared-XdMxA6`.
Mac installed as **0.204 (1190)** at `/Applications/TextText.app`.
Public desktop release was not performed.

## Gates and installation

- 662 core tests, TypeScript, required native sync suites and 40 local/remote
  CLI creation tests passed. Exact-source receipts saved.
- Signed arm64 app and all three extensions verified. Normal quit preceded
  installation; account and iCloud workspace configuration were retained.
- Installer runtime probe was disabled under the established local workflow;
  actual app startup and persistence were separately checked below.
- Standalone CLI installed under `~/.local/share/texttext-cli/source-5254ff85`,
  with an atomic command symlink replacement and prior binary retained. Local
  install receipt includes its hash and prior target.

## Actual Mac acceptance

The existing dedicated item `273adce8-01cb-4934-8079-c0397efc82a3` opened
signed in with all four headings and both prior platform markers intact.
The real editor saved `Template cohort verification 1190.`. An initial native
text-selection automation placed the cursor inside the old marker; Undo restored
it before the corrected end-of-document append and Save. Disk inspection verified
all three markers exactly once. No loss or duplicate was accepted as success.

Command K found the new body marker and reopened the item. A normal quit and
relaunch retained the saved marker, original headings, signed-in account and
same iCloud folder. The first CUA launch observation timed out; process inspection
confirmed the app was running and the next observation showed the complete editor.
This is not a startup performance measurement.

The already-open Safari editor received the new marker automatically without
Reload or Retry. CLI local search also found the same item and current hash.
Windows and Oracle deployment acceptance will be recorded separately when done.

Logs: `/tmp/texttext-sync-5254ff85.log`, `/tmp/texttext-mac1190-build.log`,
`/tmp/texttext-mac1190-install.log`.
