# Native file CAS mirror wake

The installed [1273 image refusal](2026-10-19-mac-1273-image-reopen-refusal.md) remains preserved; no recovery action or physical acceptance is claimed by this source fix.

## Cause and change

Closing the native shared owner schedules a mirror pass before an ensuing file CAS. A controlled actual WK bridge/controller fixture held the CAS until that pass finished, with the filesystem watcher disabled through an internal constructor dependency. Before the fix, only that first pass ran: the server retained the old pack and fresh shared open returned `local_changed`. The meaningful RED had three intended assertions, not a setup failure.

After a successful native `write`, the controller schedules its captured connection only while the selected root, connection and authenticated account still match. Failed CAS, changed account, stopped/replaced connection and changed root do not wake another connection. Normal constructors keep existing behavior. No expected-hash, baseline, lifecycle, epoch, binary or reopen timeout guard changes.

An independent real HTTP/native-engine fixture confirms the current image pack is retained when pre-ACK open correctly refuses, and one mirror pass uploads the exact JPEG and permits fresh open. Thus this controlled sequence has no intrinsic lifecycle admission deadlock; the separate filename/lifecycle issue is not resolved here.

## Evidence

- Causal RED: `/private/tmp/texttext-image-wake-red-20261019/test.log`, actual WK/controller plus loopback HTTP, one test/three expected failures. RED source copies retained there.
- Initial GREEN: `/private/tmp/texttext-image-wake-green-20261019/test.log`, five tests passed.
- Expanded focused main run: `/private/tmp/texttext-image-wake-final-focused-20261019/test.log`, six passed, zero skips, exit0; owned controller/wake-test hashes unchanged and owner Package restored exactly. Concurrent lifecycle drafts prevent a whole-main frozen-source claim for that run.
- Coherent affected verification: `/private/tmp/texttext-image-coherent-4f-20261019/test.log`, exit0, **46 passed/zero skipped**: wake5, HTTP handoff1, connection13, collaboration24, local-handoff1, folder-rename1 and folder-recovery1. All Swift before/after hashes match; owner Package remains `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`.

The coherent verification uses a fresh git archive of product `4fdddd4ad9d854f1523c16ca1836e92d17e3b501` (archive SHA256 `9fdd23edddff3d1da1cbad895cf4d02e5a42342117f4b85e4996b28f5c22c712`), the three explicit image source/test overlays, and two parent-owned test-registration overlays. Its manifest records every overlay; all Swift source/test bytes are guarded before/after. Same-lock dependencies and compiler cache are reused with normal compiler invalidation; no unfinished lifecycle drafts enter that source. Genuine same-product generated policy fixtures support the required bridge tests.

No normal app rebuild/install, real-fixture mutation, browser campaign or Windows product fix is claimed. Windows has a separate explicit post-CAS Changed wake; its counterpart evidence is independently owned. Final coherent candidate gates and installed image acceptance remain required.
