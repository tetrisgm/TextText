# CLI account commands with a local workspace

## Cause and fix

The selected folder took precedence in `CLIWorkspace.locate`, which correctly
kept file operations local. However, command discovery and generic command
execution then rejected every local workspace without checking its account.
This was a transport-selection bug, not a sign-in failure.

Commit `ccf675f8` adds a separate account-command capability. File reads,
searches and edits still use the local folder without network access. Account
commands load the existing private credential handoff, require the portable
folder binding to match its normalized origin, verify the authoritative
workspace ID using `/api/vault`, and recheck the binding and credential before
calling the existing `/api/agent/commands`. Redirects are refused. No new
credential, login, listener or loopback service is created.

## Evidence and installation

- 106 CLI tests passed, including persisted selected-folder command discovery
  and dispatch; offline file reads; wrong origin/workspace; unbound folders;
  revoked credentials and credential rotation during verification.
- Test log: `/tmp/texttext-cli-auth-tests.log`.
- Standalone release build: `swift build --package-path mac -c release --product texttext -j 2`.
- Build log: `/tmp/texttext-cli-ccf675f8-build.log`.
- Binary installed at `~/.local/share/texttext-cli/source-ccf675f8/texttext`.
- SHA-256: `0d60b4c1eb3570f0e93e3962185c0cb4903741a3829ee3c0f97796ab7b94e69d`.
- Atomically replaced `~/.local/bin/texttext`; the previous `source-d52a9eef`
  target remains intact. `install-receipt.json` records the rollback target.

Actual installed `texttext commands` returned 16 server-advertised commands,
and `texttext do get_workspace --args '{}'` returned workspace/access/
capabilities. A local JSON read of the existing Windows sync verification note
was byte-identical before and after installation. No document writes or login
changes were performed. The installed Mac application was not rebuilt.
