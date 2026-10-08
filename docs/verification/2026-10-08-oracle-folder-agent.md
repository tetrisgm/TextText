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

## Actual Safari folder surface

After reload of the deployed canonical workspace, opened the dedicated Agent
creation verification 1207 folder, More, Add agent. The actual panel showed the
correct folder target and `This folder · Changes need approval`. Production
status showed `Set up AI in Settings` and no connected workspace provider, so
no model task or write proposal was sent. Do not claim live model/approval
acceptance from the fixture tests.

The documented Keychain development services `texttext-dev-anthropic` and
`texttext-dev-openai` exist (presence only checked; values were not printed).
They were not moved into production. Commercial ChatGPT sign-in registration
remains externally pending, separately from API-provider configuration.

The transient web loading screen incorrectly requested a Mac folder and the
assistant ready label could say Codex for a cloud provider. Source labels now
use a web workspace loading message, platform-neutral desktop folder copy, and
`Workspace AI connected` on web. TypeScript passed; this follow-up is not yet
installed/deployed. Log `/tmp/texttext-web-platform-labels.log`.
