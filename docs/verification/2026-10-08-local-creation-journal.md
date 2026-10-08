# Local CLI creation journal

Source: `LocalCreationJournal.swift`, `CLIWorkspace.swift`, and `LocalVaultTests.swift`.

The explicit retry key now binds the requested title, body, folder, kind and source
URL to a durable intent and stable item identity. The complete TextPack is flushed
before the intent; the intent and directory are flushed before create-only
publication. An interrupted recorded publication resumes its prepared package.
An unrecorded preparation remains hidden and is never overwritten.

Retries locate the identity after a rename and preserve subsequent edits. Changed
payloads, duplicate identities, missing published files, corrupt journal records,
and incomplete bounded identity scans fail without creating a replacement.

Verification: `TEXTTEXT_STORE_LOCAL=1 swift test --package-path mac --filter
'LocalVaultTests|DocumentStoreTests'`, **64 tests passed**.
Log: `/tmp/texttext-creation-journal.log`.
New regression coverage exercises rename plus later edits, changed payload,
deletion, capture retry, duplicate identity, prepared-intent resumption, and four
concurrent local attempts publishing one identity.

Limits: the local flock is not a distributed lock between iCloud devices. This
receipt does not prove simultaneous cross-device keyed creation, filesystem
power-loss behavior, provider eviction or installed desktop integration. No
journal eviction is performed. The lookup scans at most 5,001 documents and fails
at that bound instead of interpreting an incomplete scan as absence.

## Installed CLI acceptance

Release CLI built from exact clean source `ffbc83ee` and installed at
`~/.local/share/texttext-cli/source-ffbc83ee/texttext`, replacing only the
verified existing symlink in `~/.local/bin`. Previous binary retained; no job.
Build log: `/tmp/texttext-cli-ffbc83ee-build.log`.

Separate processes in the real iCloud workspace created the dedicated item,
renamed it, appended a later edit, and retried creation with the original key.
The returned path was the renamed path; package SHA-256 stayed unchanged and
later content survived. A different body with the same key rejected without
changing the hash. Evidence: `/tmp/texttext-cli-creation-installed-ffbc83ee.json`.
Item: `Agent creation verification 1207/Renamed creation verification ffbc83ee.textpack`.
No existing user items were edited. Installed Mac rendering and cross-device
journal behavior are not implied by this CLI acceptance.
