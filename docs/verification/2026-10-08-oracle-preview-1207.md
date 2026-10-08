# Oracle preview update and live restart reconnect

Source `2cc028b9`, deployment `texttext-oracle-20261008-2cc028b9-preview`.
Live path `/home/ubuntu/texttext/releases/20261008T180429Z-texttext-oracle-20261008-2cc028b9-preview-40600b`.
Fresh backup `texttext-20261008T180452Z-6886d7ca.dump`.
All thirteen live release checks passed. TextText and all three Algorave services
remained active. Logs: `/tmp/texttext-preview1207-oracle-{build,package,deploy}.log`.

Under the owner's existing obsolete-deployment cleanup authorization, removed
46 old release/incoming directories, retaining the live release and previous
rollback. Unmatched directories, all backups and user state were preserved;
no active process had a working directory in a removal target. Free space rose
to 31 GiB before the new deployment.

The outgoing PID 3683421 reported three active reads at 18:05:18 UTC, then systemd
recorded **Deactivated successfully** and started PID 3685674 in the same second.
No timeout or SIGKILL. `SuccessExitStatus=130 143`, `Result=success`.
This attests the normal-exit classification follow-up on an ordinary rollout.

The already-open actual Safari session showed no connection error after restart.
Without Retry/reload, opened the existing dedicated verification note. Appended
`Automatic restart reconnect verification 1207.` through the signed-in CLI using
a stable idempotency key. Safari received it automatically; installed Mac 1207
opened the same marker with all original lines and presence. Independent CLI
read confirmed stable item ID `466761a0-c4e2-4fad-8214-c976fcc30a7a`, one marker,
and hash `95deffb5012d1b079a4aaf032faaa6cfa10c12ab19cc6c50a4ce544f1962ca5c`.
No other user content was edited.

Then loaded the canonical workspace URL to obtain the new shared UI. Account,
existing note, marker and presence survived; home retained List and returning
from the note showed saved titles. **Cold home still briefly displays filenames
until its first preview reads complete.** This update improves return navigation
and same-path invalidation, not the initial listing/title contract.

This is one actual restart/direct-file delivery path, not the entire failure
matrix, second physical iCloud device or current Windows acceptance.
