# Oracle folder-agent deployment

Source `af65cbc6`, deployment `texttext-oracle-20261008-af65cbc6-folder`.
Live path `/home/ubuntu/texttext/releases/20261008T193440Z-texttext-oracle-20261008-af65cbc6-folder-ff7056`.
Pre-migration backup `texttext-20261008T193502Z-c406f334.dump`.

Exact clean-source verification: **828 core tests across 87 files** and all
native file/durable sync regressions passed. Required receipts matched before
web-only shipping. Standalone build, Linux ARM64 package, TypeScript, Oracle
release/bootstrap checks and all **13 authenticated live checks** passed.
Logs `/tmp/texttext-folder-required-sync.log`,
`/tmp/texttext-folder-oracle-{build,package,deploy}.log`.

After deployment, TextText and all three Algorave services were active. The
previous release remains available. No HAProxy or Algorave configuration changed.
No public Mac release was published. Fresh principal smoke scratch data was
removed by the established deployment probe.

Actual Safari also received the separately installed CLI creation fixture:
`Agent creation verification 1207/Renamed creation verification ffbc83ee.textpack`
opened with the original creation text and later direct CLI edit. This was
verified before rollout and is distinct from the new hosted folder task.

Actual Safari hosted folder model/proposal approval remains next. The required
existing TextText Changelog package was not found in the configured iCloud root;
no duplicate changelog was created.
