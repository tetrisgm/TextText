# Retained move boundary verification

Source checkpoint: the eight source/test files and exact SHA256 values are recorded in `/private/tmp/texttext-retained-move-native-full-final-20261018-source.json`. Package.resolved retained the original git blob `ecef5ee26c5bc34cddc75ad2aa80b7394857c591`.

## Behavior

- Store and Sync rename use an exclusive same-volume Darwin rename with no symlink traversal. A private operation lease protects durable staging, identity/path registration, capture, classification and explicit consent.
- The actual raced source inode stays visible at the destination. Immutable prepared and observed destination snapshots preserve inspected bytes; the observed snapshot is not a claim that a detached inode was retained. Different actual bytes refuse the original move acknowledgment and fence both endpoint paths and the expected identity across restart.
- Recovery exposes source and destination independently, including exact opaque or absent observations. Keep current files exports all observed versions, rechecks both paths and scope immediately before durable consent, and never rolls back or overwrites either path. Ambiguous or unverifiable third locations block consent while retained snapshots remain downloadable.
- Lost replies replay only the exact prepared destination. Completed moves permit later visible edits, including an existing writable descriptor, and later supported saves use the retained replacement primitive.
- Path preflight fences precede read and metadata coordination, avoiding reentrant waits during an active move. Identity/path checks remain inside reads for races.

## Evidence

- `/private/tmp/texttext-move-red-marker-green-final-20261018.log`: prior rename returned the stale projection and did not fence restart, two expected red assertions.
- `/private/tmp/texttext-retained-move-native-full-20261018.log` and `/private/tmp/texttext-native-move-gate-hang-sample-20261018.txt`: first full run stopped by the test owner after a reproducible nested coordinator deadlock in the new active-move fixture; not a passing gate.
- `/private/tmp/texttext-retained-move-preflight-strict-final-20261018.log`: strict scanner exposed four consent failures from inconsistent Foundation path spelling; corrected using canonical Darwin root/candidate paths after symlink rejection.
- `/private/tmp/texttext-retained-move-preflight-strict-second-20261018.log`: 30 registry tests, two opt-in benchmark skips, zero failures, including active read/metadata refusal, strict third-path scan, invalid UTF8 endpoints, collision preservation, prepared/captured interruption, explicit consent and later descriptor edits.
- `/private/tmp/texttext-retained-move-native-full-final-20261018.log`: full required Swift selection with `TEXTTEXT_STRESS_ACTOR`; app 50 tests (four skips), FileProvider 218 (six skips), CLI 40, zero failures, exit zero.

No installed application, live account migration, public release or physical-provider move claim is made by this source gate. Case-only rename remains a separate follow-up; this checkpoint retains the existing occupied-destination refusal.
