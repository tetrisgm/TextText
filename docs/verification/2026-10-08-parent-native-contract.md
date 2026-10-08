# Parent picker native contract correction

Source `1e983413`, frozen candidate
`/private/tmp/texttext-candidate-1194-MSSK3k`.

Actual Mac 1193 acceptance found no parent choices. Its native listing contains
paths only; the old picker required IDs and titles. Web listings also omit
titles. The shared picker now searches the existing index on demand, limits
results to twenty, and reads the selected TextPack before storing its stable
identity. Existing references resolve their saved title on reopen. Forbidden
template paths, self references, replaced identities and lost access are rejected.
Search and selection requests are cancelled when superseded or dismissed.

- Ten focused reference/field tests passed.
- Both full note and parent browser flows passed in the frozen candidate. The
  full-app fixture now uses native path-only listings and verifies the saved
  parent ID and resolved title after reopening.
- Exact-source core gate passed 762 tests in 78 files and TypeScript.
- Required native gate passed; both receipts match the frozen source.

The first core run failed after candidate dependency preparation overlapped it.
After the lockfile installation completed, the fresh gate passed. No failing
receipt was used for a build. Oracle shipping also refused while the Mac build
temporarily changed its Store lockfile; no production action occurred.

Logs: `/tmp/texttext-candidate-1194-sync-resume.log`,
`/tmp/texttext-candidate-1194-note-browser.log`.

Mac **0.204 (1194)** is installed at `/Applications/TextText.app`. Signing and
arm64 verification passed for the app and all three extensions. Startup retained
the signed-in account, iCloud root and open verification note. Actual native UI
searched and selected `Parent navigation verification 1193`, then appended
`Parent navigation save verification 1194.` to its dedicated child note and
navigated to the parent without first pressing Finish. Reopening the child
retained both the edit and saved parent title. Disk inspection confirms parent
ID `6c675f6a-142c-46e4-8dc3-4a944811855e` and exactly one new marker. The child
was left saved. Automatic runtime health remains sandbox-private; this is actual
UI and file evidence, not a passing runtime-health report.

Windows passed native core/agent tests, 302 shared-client tests in 35 files,
TypeScript, publish and actual desktop/editor/close/activation smoke. Candidate:
`C:\Users\Shokunin\dev\texttext-build-1e983413\windows\build\candidate-94b31c125f15407ca1a546a521cd0661`.
Smoke receipts:
`C:\Users\Shokunin\dev\texttext-build-1e983413\windows\build\smoke-receipts-3b7a507865fa4bbdbeeb8823e331eb8b`.
The installed Windows process is still running; replacement awaits its normal
save/close. Logs: `/tmp/texttext-mac1194-build.log`,
`/tmp/texttext-mac1194-install.log`, `/tmp/texttext-windows-1e983413-build.log`.

Oracle deployment and actual Safari acceptance remain pending. No public desktop
release. This does not certify complete Supernotes fidelity or all extensions.
