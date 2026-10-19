# Mac1273 owned known-generation rename

**Bounded installed acceptance passed for one owned, known-generation item.** Unknown-generation fixtures remain held; this is not all-six rename, recovery, soak or performance acceptance.

## Installed source and protected fixture

Normal0.204/build1273 came from frozen `4fdddd4ad9d854f1523c16ca1836e92d17e3b501`. [Candidate proof](2026-10-19-mac-1273-4fdddd4a-candidate.md) and [complete stopped backup](2026-10-19-mac-1273-backup-materialization.md) preceded the root-run supported installer, exit0. Actual executable SHA256 `8745344e2797ccd167febd199ecec7ae23cd05b1f1bfe63978678b4daef819c7`; runtime health reported only nonblocking `finder.provider`. Installed proof `/private/tmp/texttext-normal-1273-installed-proof-20261019.json`, SHA256 `d8d471ec10add896e8cb8266aa03dec78e28c17c080ab5fe91920b240545f6d2`.

Only owned restored item `ad9bf5f1-179b-44aa-87d3-adeef4e78916` was renamed, in its existing owned folder, to `Installed 1273 known-generation rename acceptance ad9bf5f1.textpack`. Fresh authenticated GET and local pack/schema checks agreed before the action: archive `92aa8bc2e7abe6dafc8020ba6e8f8e8ad7cd01e2bf6ddf82b726c710d01b5178`, lifecycle `2d5a56a8-4d6b-4233-b372-3fd77bb35e5f`, settled baseline, exact body and original comment. Destination was absent. No generation was invented or copied from another fixture.

## Actual sequence

1. Root used normal **Rename or move → Save path**, observing the new Help path with title/body unchanged.
2. First actual post-action poll already showed server path **and native baseline.path** acknowledged the new path. Local/server archive bytes still matched92aa exactly; old local path was absent. Outbox, conflicts, binary outbox and saved rename were clear.
3. Normal CmdQ completed. Fresh process inspection proved canonical app absent before/after a new authenticated read, with the same new path, acknowledgement and exact content/comment/lifecycle proof.
4. Root normally reopened. The first app lookup timed out after5seconds; inventory showed the app running and canonical rebind succeeded. No kill, extra bundle or second process was used. Reader showed exact prior title/body and new Help path without a warning.
5. Fresh delayed proofs at110ms,45,050ms and90,204ms passed; actual authenticated server GETs ran at0and90seconds. The target path, baseline and clear pending maps held while other-item UI activity stayed separate. This spans more than two default30second scheduling intervals; native request count was not instrumented.

## Preserved archive distinction and exact oracle

The initial delayed attempt deliberately stopped on raw archive inequality after reopen: local became `c728c84b0ff9d4bb5ea16ba5e8951764d3e7b5540033fc34a8c0ea5773879bca`, server remained92aa. Its failure and original packets remain under `/private/tmp/texttext-1273-owned-rename-delayed90-20261019`.

Entry comparison established the precise difference: every entry name and every other uncompressed entry byte matched. `text.md` changed only its single `slug` frontmatter line, from exact old relative path to exact new relative path, with body bytes unchanged. Projection JSON retained the exact five-key set and identical `document`, `documentSha256`, `itemId` and `version` values; only `markdownSha256` changed and each value was checked against its actual Markdown bytes. Container timestamps/attributes also differed. Product `model.ts:83,96` derives slug from current file path; `markdown-files.ts:201` emits it; native checkpoint closure `document-session.ts:77` writes that projection.

The fresh90second oracle accepted **only that exact derived difference**, not generic metadata differences: full product schema, raw document/comments, lifecycle, new path and pending-clear checks remained strict. Baseline.localHash matched actual localc728; baseline.revision matched actual server92aa, without falsely acknowledging a different server archive. Document SHA256 remained `8779fa533ee0818d548f6cbc696be5ba169df3ca8298c6565217dae896587982`; full comments SHA256 remained `d4b9cc7d57b8423f38884715ceecf2f9be04be66b64549dd093fdae4e86ef923`.

| Evidence | Private path | SHA-256 |
| --- | --- | --- |
| Fresh preflight | `/private/tmp/texttext-1273-owned-rename-fresh-preflight-20261019/proof.json` | `5032fbee0f4445cda7c90d7f5cca46dfda5ebbec3a02ff1a355215b732682b23` |
| Open-editor acknowledgement | `/private/tmp/texttext-1273-owned-rename-postproof-open-20261019/settled-proof.json` | `92392a6662f367b331757359de417bb667122202a761b4a21d11920df0cac780` |
| Normal-quit process absence | `/private/tmp/texttext-1273-owned-rename-postquit-20261019/settled-proof.json` | `c031d537dfb1c524c8b3e38e44d1c1925d02ac04138e3b5c7a58c405280ce9a9` |
| Delayed strict derived-projection summary | `/private/tmp/texttext-1273-owned-rename-derived90-20261019/summary.json` | `1323667330a2b25efee6c4d40a62b4e5c3c29d88f110aeb31879d80b6ea8ee92` |

All read contexts disposed and helper sessions exited. These helpers performed no fixture edits. Root owns any later UI actions and receipts.
