# Windows outgoing folder casing

## Scope

Source implementation of the owner-only automatic same-parent casing lane in [the protocol](../sync/folder-case-moves-v1.md). General folder moves retain owner review. This receipt does not claim a deployed server, installed native candidate, or completed multiplayer campaign.

The native engine records the authenticated complete folder catalog, original document topology, raw manifest revision, and physical directory identities. It recognizes a unique external casing change, preserves empty descendants, saves one immutable account/root-bound folder operation before any child sends, and validates the whole receipt before adopting item/shared-checkpoint paths. Pending shared journal batch, epoch, sequence, and generation survive unchanged. Existing attempted per-item operations are never rewritten.

Profile floor three retains exact profile-v2 and actual displaced bytes and verifies the prior profile chain. Known floor-two factories refuse the new marker; this does not claim arbitrary historical/raw readers honor a marker they never inspected.

An HTTP error, including 409, does not prove rejection before publication. The exact command remains replayable, including after a committed operation returns 409. Cancellation requires a separate server-authoritative durable tombstone, not a local flag or HTTP status. The cancellation/review UI integration is a separate follow-up.

## Evidence

Original real server-to-native red:

- Case-sensitive APFS server per-item move advertised both old and new folder spellings and left the empty child under the old name. `/private/tmp/texttext-folder-propagation-casefs-red.log` and exported `/private/tmp/texttext-folder-propagation-casefs-manifest.json`.
- Actual Windows correctly refused that contradictory authoritative catalog while preserving its local pack and empty child; the desired propagation assertion failed. `/private/tmp/texttext-t13-propagation-red-core.log`.
- Own sparse image `/private/tmp/texttext-propagation-casefs-71a2a504c037.sparseimage` retained; its mount was detached successfully. Device/mount ownership: `/private/tmp/texttext-folder-propagation-casefs-ownership.json`.

Latest Windows code snapshot:

- Archive SHA256 `c61fc1e810b3a2a46c3595f18c3f975ad0a9e95263c84f942c39e57836407156`.
- Exact ten-file manifest `/private/tmp/texttext-folder-propagation-full-source.json`, including unchanged bridge sources for attribution.
- Actual PC full Core: **1,060 assertions passed**; bridge: **81 passed**. Logs `/private/tmp/texttext-folder-propagation-full-core.log` and `/private/tmp/texttext-folder-propagation-full-bridge.log`.
- Actual PC Core DLL SHA256 `1c6c1e6ecb09b468e238620d9a00ebcf68fd5b2f9f6bafb217a8b9ceaad80962`.
- Mac portable full Core: **953 assertions passed**. `/private/tmp/texttext-folder-propagation-mac-core.log`. Mac bridge: **58 passed**, `/private/tmp/texttext-folder-propagation-mac-bridge.log`.

The focused physical Windows suite passed **65 assertions**: pack/shared/empty-only trees across ordinary success, lost reply, and committed-then-409 replay; four profile publication interruption stages; exact HTTP endpoint/account/capability fields, including a workspace named `items`; fresh remote text revisions before command creation; foreign directory identity, changed topology, unknown entries, bad receipts, changes during awaits, future fields, capability loss, existing upload, and immutable conflict replay refusals.

The first full run caught an overly broad missing-baseline guard that blocked legitimate remote case pulls. The corrected guard distinguishes retained original spelling from a newly instructed remote spelling. Original full red: `/private/tmp/texttext-folder-propagation-pull-guard-red.log`; both existing remote folder scenarios pass in the latest full gate. Earlier fixture-only missing exception classifications are separately retained under `/private/tmp/texttext-folder-propagation-refusal-*`.

## Limits

A folder changed before its physical baseline exists needs review. An affected existing per-file/binary/shared-rename outbox command also needs review; it remains immutable. Unsafe, unreadable, unknown, or over-bound subtree membership refuses automatic execution. Ordinary content revisions before intent use the fresh authenticated revision without relabeling the native content hash baseline. Current server topology races preserve the exact command and all current files.

The transport fixtures exercise the production native engine, actual Windows directory identities, and shared checkpoints. Real server executor tests are separate evidence; these fixtures alone are not six-client acceptance.
