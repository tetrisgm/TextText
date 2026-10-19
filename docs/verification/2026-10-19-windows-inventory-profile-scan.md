# Windows workspace inventory recovery

Source: `1d1154f2a9a92d7b3696b7d6f4abfbaf73983707`.

The installed recovery build `f11bbcb6` completed normal saved-work migration, but opening a new blank acceptance note timed out before editing connected. Two actual process stack captures showed `ScanInventory → Read → ReplacementRecoveryRegistry.OwnerHash → RetainedReplacementProfile.Verify` while other inventory calls and sync waited on the store monitor. This was local work, not evidence of a server protocol failure.

The fix shares profile verification and a registry instance only within one synchronous, store-serialized inventory scan. The existing shared migration lease spans the scan. Exact owner bytes and the full profile chain are rechecked before returning; per-entry recovery remains enabled. Standalone reads retain their checks. Concurrent bridge inventory requests share the resulting scan; changes during scanning still invalidate its cache.

Focused checks passed on actual Windows and Mac: 12 profile/concurrency assertions and two bridge assertions each. The actual Windows floor-six 1,100-document scan measured 9,391 ms; Mac measured 2,490 ms. These are controlled measurements, not installed editing acceptance. Changes to owner/profile during scanning, changes between scans, and scope cleanup after failure were checked.

Evidence: `/private/tmp/texttext-inventory-profile-fix-20261019/`, including `final-eight-hashes.json`. The earlier transfer preparation failure from macOS archive sidecars is preserved separately.

The old installed process exited naturally after the exact save-dialog OK action, Back to Notes, and normal window close. No force-close, reset, or content deletion occurred. The exact-source official build passed all required gates (1,778 Core assertions, bridge/agent, shared client, TypeScript, UI and desktop smoke), plus the existing packaged-policy supplemental check. Source inventory stayed exact: 3,388 files, SHA256 `3328ee908356a4a211c560044777528e3040843e0565cd0ab7de3e68f81da819`. Archive SHA256: `785a72427f0739b0d3fa72f7d62d167ee8bba4b73aa775389bdfa0d3b4cf4661`. A fresh stopped backup preserved the previous app, workspace, state and opaque credentials before supported installation. Installed EXE SHA256: `d9f1d0da0a52fb6c90f12f2b2c89a7524fd1b19773c326681bd9dd9339a6a291`.

## Installed normal acceptance

The existing owned note `e788d2a2-207d-4c83-bbd4-f356e746aae6` (`Notes/Untitled 21.textpack`) was edited through the normal UI. Title and nonempty body persisted locally and on the hosted service, with exact pack/revision SHA256 `daf3e799b2aea491b83cdab79948205ef24484627d8cc944ddbc061f11b99e6f`. Native checkpoint pending count was zero and its projected hash and acknowledged revision matched that revision. No CLI, model or file content writes substituted for typing.

The initial editing session retained its save guard on two close attempts; both refusals remain preserved. Supported Back to Notes followed by normal close exited naturally. A fresh normal launch reopened the exact saved title/body, and normal close **from that reopened note** exited naturally too (`normal-reopened-note-close.json`). No force-close occurred.

A final normal launch, without a workspace/profile override, reopened the same note with exact rendered title/body and was left open (PID 48840, HWND 27463070, 2026-10-19T23:26:10Z). `normal-final-open-window.png` visually confirms the saved content. Existing legacy conflict and retained work were preserved. This establishes ordinary nonempty save and fresh reopen; it does not claim the initial immediate close guard passed.

Private delivery and runtime evidence: `/private/tmp/texttext-pc-inventory-1d1154f2-20261019/` (`normal-build-result.json`, `installed-inventory-proof.json`, the close/reopen receipts and final screenshot). Independent hosted readback: `/private/tmp/texttext-pc-hosted-save-read-j3rf3mr0/hosted-proof.json`. Stopped backup evidence: `/private/tmp/texttext-pc-stopped-before-inventory-20261019/`.
