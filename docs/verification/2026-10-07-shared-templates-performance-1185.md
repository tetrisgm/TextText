# Shared templates and performance, build 1185

Verified source `68eaaf80`. Mac 0.204 (1185) is installed at
`/Applications/TextText.app`; Windows uses the same source. Oracle serves
`texttext-oracle-20261008T063810Z-68eaaf80`. No public desktop release.

## Verification

- Frozen-source sync gate: 541 tests in 49 suites, TypeScript and native Mac
  gate passed. `/tmp/texttext-sync-68eaaf80.log`.
- Actual browser recovery, proposal cards, web agent targeting and shared
  editor checks passed. `/tmp/texttext-web-agent-68eaaf80.log`.
- Reader browser regressions preserve complete text and editing in both themes;
  unchanged status/presence does not reparse. Body, assets, theme and template
  changes invalidate correctly. `/tmp/texttext-reader-68eaaf80.log`.
- Mac build/signatures/three extensions passed; normal-close replacement kept
  account, iCloud folder and saved note. Added one verification line, found it
  through search, and reopened it after normal quit. CUA cursor selection first
  misplaced the line; Undo restored it before ordinary end-of-document typing.
  Only dedicated verification content changed. Build/install logs: `/tmp/texttext-mac1185-*.log`.
  The established local installer reports runtime health unverified; actual
  startup/editor acceptance is separate evidence.
- [Windows acceptance](2026-10-07-windows-shared-1185.md).
- Oracle deployment passed all 13 authenticated smoke checks, including audit,
  retry, delete/restore and old-generation fencing. Previous release retained.
  TextText and all three Algorave services remained active; shared proxy and
  runtime environment mtimes unchanged. `/tmp/texttext-oracle-68eaaf80-deploy.log`.

## Live agent creation

Installed CLI created item `273adce8-01cb-4934-8079-c0397efc82a3` from Research
version 2 with its four starter headings. Repeating the exact command/key
returned the identical receipt. Mac and Windows received the file without a
manual sync; their actual UI opened it. Safari opened the same item and showed
Mac and Windows presence. Its Add agent action opened the correct target without
sending a request. No web model is configured, so this does not attest model
execution. Evidence: `/tmp/texttext-create-template-item-1185.json` and
`/tmp/texttext-created-template-item-read-1185.json`.

Template approval tests exercise the public dispatcher and real file engine
with a memory SQL repository: lost acknowledgements, concurrent recovery,
expired receipt-only replay, current grants and refusal to start expired writes.
They do not simulate a real PostgreSQL crash. Custom creation tests cover latest
and pinned definitions, starter overrides, source changes under authorization,
ambiguous versions, malformed unrelated artifacts and byte-identical retries.

## Performance and remaining work

The same bounded 525 KiB production fixture opened in 170 ms and reopened in
254 ms, compared with 1,533–1,624 ms and 1,513–2,267 ms before the fixes.
[Measurements and limits](2026-10-07-file-vault-bounded-performance.md).
This is not a long-duration memory or every-device performance certification.

Visual template proposal previews remain in progress. Home List accessibility
labels and agent target labels exposed filenames instead of saved titles; that
is under repair (the visible List title already uses the saved title).
Full reference-service fidelity and external provider/device limits remain in
[handoff](../HANDOFF.md).
