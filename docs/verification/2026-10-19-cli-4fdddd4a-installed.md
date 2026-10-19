# Local CLI 4fdddd4a installed

The supported pre-authentication installer now resolves `~/.local/bin/texttext` to `~/.local/share/texttext-cli/source-4fdddd4a/texttext`. The executable came from the genuine, unfiltered Release product of the [passing normal 1273 candidate](2026-10-19-mac-1273-4fdddd4a-candidate.md), source `4fdddd4ad9d854f1523c16ca1836e92d17e3b501`. No additional compiler run was used.

Unsigned SHA256 `fedfe094965abfcbffb26659dc6f3a4e7ca1c10911e9f1a6a05662baf43d2fac`; signed SHA256 `ee027a4e4765e40350fe5f0bdb9cb18a61cf929f4cedf78e757e12c51b93b19f`. Signing used the existing Apple Development identity. Strict signature, arm64 and isolated help checks passed; the help home remained empty.

The previous symlink was preserved by rename as `source-4fdddd4a/previous-shim` before the supported `install` command created the new symlink. The previous b4b74765 binary remains unchanged, SHA256 `c804822ebe331cf3e9f99b5d13d58eedc81f2f8c3eef2398da505e8d35e491ba`. Canonical Mac1272 executable and owner Package.resolved hashes remained unchanged. No authentication command or credential mutation ran. Authenticated current-CLI readback is deferred until the stopped full backup is complete so credential renewal cannot disturb that inventory; prior-version readback is not attributed to this binary.

Receipt `/private/tmp/texttext-release-cli-4fdddd4a-20261019/release-cli-receipt.json`, SHA256 `ab388b99028281de8b4306e95d4d08f91f5839203a4601465718370b29933dc1`, is also copied into the new installed directory. This is a local CLI install, with no public Mac release.
