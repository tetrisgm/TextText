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

Mac build, Windows verification, deployment and actual parent selection/navigation
acceptance remain pending. No public desktop release.
