# Reusing the installed Codex helper during a local build

The `b9eb96fb` combined release stopped before delivery with exit 133. The exact
failing command was `build-app.sh`'s invocation of the installed
`/Applications/TextText.app/Contents/Helpers/codex --version`, after successful
App Intents metadata generation.

Mac crash report `codex-2026-10-22-234906.ips` records SIGTRAP at
`_libsecinit_appsandbox.cold.6`, before runtime main. Read-only entitlement
inspection showed `app-sandbox=true` and `inherit=true`: this helper expects its
sandboxed parent, not an unsandboxed build shell. The installed bundle already
records `TextTextEmbeddedAgentVersion=codex-cli 0.153.4`.

The coordinator now verifies the installed bundle and helper signatures, reads
that same bundle's version, and passes explicit metadata with its helper path.
The builder validates a single-line Codex version without executing an inherited
helper. External runtimes still use `--version` when no metadata is supplied.
No runtime bytes, entitlements, signatures or health gates were weakened.

Mac regression: the exact committed assignment with a fake exit-133 executable
reproduced exit 133. The patched shell test passed explicit metadata without
launching that fake, normal external fallback, preserved fallback failure and
refusal of empty, malformed and multiline versions. Shell syntax passed; the
installed parent bundle's strict signature verification also passed read-only.
Independent diff review found no blocking issue. Test copies are under
`/private/tmp/texttext-codex-version-review`; no installed helper was executed.

The failed run recorded `delivered=[]`, removed its lock and restored the owner's
pin exactly (`eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`).
No actual installation occurred. A new same-commit release remains required.

Documentation verification passed on the Mac (534 docs, 232 scripts, 12
archives). A supplemental PC run reported seven Mac-only missing-path findings
in the existing documentation; no paths or checks were fabricated to suppress
them. The required Mac check is the authoritative environment result.

The next coordinator invocation builds the Windows candidate alongside the Mac
gates and candidate, using shared SSH argument construction. It awaits the
parallel helper inside owner-pin preservation; deployment and installation begin
only after both lanes succeed. The former later Windows build is removed.
Mac focused tests passed 17/17: six parallel-helper tests, one added integration
test proving committed pin retention until child completion after a Mac failure,
three pin tests and seven checkpoint/receipt tests. No deployment follows a
failed join. Both lane failures remain visible.

Joining owns the local SSH process; an independently lost SSH connection does
not prove the remote job stopped. Such a connection failure requires checking
the PC before retrying. No actual parallel build was launched by these tests.
