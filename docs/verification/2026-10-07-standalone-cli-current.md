# Standalone CLI update

Installed the standalone `texttext` CLI from source `d52a9eef82b29cd48c26a0af58929cec3842a15c` on the owner's Mac. This is a local source build, not a public release or a new Mac app build number.

- Built only the executable: `swift build --package-path mac -c release --product texttext -j 4` (20 seconds).
- `swift test --package-path mac --filter TextTextCLICoreTests`: 98 tests passed.
- Binary: `~/.local/share/texttext-cli/source-d52a9eef/texttext`.
- SHA-256: `ef758fba037fdd686284ac96ce341b27db5b3d43a350b41dba461b3dcda46e20`.
- Atomically replaced `~/.local/bin/texttext` symlink. Preserved the prior target `~/.local/share/texttext-cli/0.204-1158/texttext` unchanged for rollback. Local `install-receipt.json` records both targets and source identity.
- Existing saved workspace resolved without configuration changes. Read/search/lint succeeded on `Notes/Windows sync verification 20261007.textpack` in the existing iCloud workspace. Search returned one matching item, identity `6df95934-cd09-4a73-b9e6-a6fb8a453547`.
- JSON read before/after installation was identical, hash `1e0dfa3a01fb63881ffe026c4baed6738968cf1236c8e0bef267e0f56964b7f8`. No document writes, sign-in changes or credential inspection.
- Build/test logs: `/tmp/texttext-cli-current-build.log`, `/tmp/texttext-cli-current-tests.log`.

Rollback consists of atomically repointing the command symlink to the preserved 1158 target. The installed Mac app and its bundled Codex runtime were not changed.
