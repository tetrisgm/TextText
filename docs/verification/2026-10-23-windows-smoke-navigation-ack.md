# Windows smoke navigation acknowledgement

The unified `2b470873` release stopped before delivery. Its Windows desktop smoke failed at gallery creation because the previous bookmark remained selected: `New from template` exists only on the overview. Evidence: `windows/build/smoke-receipts-67c709b45ad64f10bb538b7c688745b2/desktop-smoke.json` and `/private/tmp/texttext-ship-all-2b470873.log` on the Mac.

The harness dispatched a fire-and-forget file-open event, then accepted a title already visible from its direct write as completion. Its subsequent Home click could encounter `operate` while busy and be ignored. The smoke now awaits the existing native-open acknowledgement and enabled context controls before advancing. Each template asserts that acknowledgement. Production navigation and durability guards are unchanged.

Checks:

- Corrected focused `windows/scripts/smoke.ps1` via existing elevated PC SSH: exit 0. Receipts: `windows/build/smoke-receipts-5a973641a7634b8c974ec4d4eff41877`; template creation/edit/reopen and actual MainWindow durable-close tests passed.
- Mac: exact changed smoke entry compiled through `buildLocalVault` into `/private/tmp/texttext-smoke-navigation-bundle-final`, exit 0, with source imports resolved to the existing checkout. No Mac checkout changes.
- An intermediate harness check incorrectly required selected-item controls before opening a bookmark created in overview; its failure is retained at `windows/build/smoke-receipts-cf3c0f92304f4063881a29981f6260cc`. The corrected precondition accepts enabled context controls in either state.

These are disposable native regression windows, not installed acceptance. Unified release and installed exact-content acceptance remain pending. No existing data, journals, or failed receipts were removed.
