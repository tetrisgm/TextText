# Mac 1264 installed account review and ordinary note

T03–T04/T26, October 18. Product source `cd65ea30c4a4b0a831a2a88afcc3baac01d5c8e6`. This supersedes the Mac identity-review blocker in the [interim delivery receipt](2026-10-18-interim-installed-delivery.md); broader acceptance remains open.

## Verified artifacts and delivery

The pristine 3,086-file input fingerprint was unchanged before/after: `51e7ad7cbd5cf93e7f1f2276c792114608e55e82cd17de48555e4e1776cab4f9`. The genuine full 22-check release gate passed, including 5,134 web tests (161 documented optional skips), local database 123 tests plus four scale checks, and native unit checks. Separate full sync verification passed. Normal Store-shaped build **0.204 (1264)** passed strict signing, arm64/three-extension checks and 18 isolated health checks.

The official installer, with exact source app/version/build and default required runtime health, exited zero. `/Applications/TextText.app` is build 1264; executable SHA-256 `2345c11d0d0a4ad26590766cec2ca583a1ddd542600f089a00bed977c65e132c`. The Finder-provider warning was nonblocking; no health override was used. No public Mac release occurred.

The matching signed release CLI is installed through the existing shim at `~/.local/share/texttext-cli/source-cd65ea30/texttext`, SHA-256 `9ac8a5a4aa37f40a5ed2997d3d3dd93def1c89aaa9848b884713b7d36346acab`. Signature and help checks passed; previous F994 binary retained. No authentication changes.

Private build/delivery evidence:

- `/private/tmp/texttext-final-local-store-1264-cd65ea30-20261018/normal-local-build-receipt.json`
- `/private/tmp/texttext-normal-installed-1264-cd65ea30-20261018.log`
- `/private/tmp/texttext-release-cli-cd65ea30-20261018/release-cli-receipt.json`

## Actual legacy upgrade path passed

Using the installed app through native UI, File → Review saved work displayed verified-account reopen guidance. Normal Cmd-Q exited. On reopening, the same command showed the correct account and existing iCloud workspace root. Explicit **Keep saved work** returned to the workspace. No helper wrote an ownership marker, reset a journal or changed credentials.

The verified preinstall backup preserves 2,313 vault files, 528 actual device-state files and prior build 1263 at `PreinstallBackups/20261018-before-1264-pending-source`; manifest SHA-256 `df3b7d33f1e904071bf1dbc7d29948a8b55520ade132ad8f051f9eeeb5e84b55`.

Comparison against all retained pending records found both archived records byte-identical. The active pending checkpoint changed only its embedded journal's `accountId` to the verified account after explicit review. Every other journal field, pending update and batch remained exact. The original backup bytes remain unchanged. A byte-only comparison correctly reported that active record changed; the separate semantic comparison explains the single expected ownership change. Neither record is a claim that pending work was uploaded.

Private comparisons: `/private/tmp/texttext-mac-after-1264-review-pending-comparison-20261018.json` and `...-pending-semantic-comparison-20261018.json`.

## Ordinary new note passed; separate rapid-input failure remains

A new disposable note, item `1e56ca69-60ae-4762-ac6e-df6ffe0a91d6`, was edited through the normal installed editor with fresh UI observations between field changes. Exact title/body reached the authenticated server, the native checkpoint became pending=false/seq=1, normal Cmd-Q exited, and independent relaunch displayed exact content. `texttext read <item-id> --json` independently confirmed server content. This proves this ordinary path only; offline, Windows and wider installed checks remain open.

An earlier separate new note, item `e6cbd1f1-71f4-4211-89b1-8f4817e35c59`, displayed **“The server rejected this edit. Your pending document is kept for recovery.”** after a rapid title/body input sequence. Stale accessibility indexes also misdirected text into title/tag fields in that sequence; those resulting values are valid schema and do not explain the rejection. The checkpoint retains one pending update and a batch at epoch=1/seq=0. Local Yjs reduction validates its complete document. The retained batch is acknowledged, and an independent server item read matches that acknowledged revision with partial title content. Thus at least one upload succeeded; the generic message does not prove the initial upload was rejected. The exact subsequent read/poll/upload rejection cause is not established. This remains a real failed acceptance attempt, not erased by the clean pass.

Private evidence `/private/tmp/texttext-1264-newnote-rejection-20261018` preserves the checkpoint, fixture archive, installed rejection screenshot, clean independent-reopen screenshot and local diagnosis. No retry/upload/reset or recovery-copy action has been used to conceal the failure. Next: reduce actual new-item creation/initial collaboration ordering locally, then rerun affected installed acceptance after any fix. Forward recovery only; do not put an older binary onto upgraded state.
