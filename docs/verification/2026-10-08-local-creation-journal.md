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
power-loss behavior, provider eviction or delivery in the installed CLI. No
journal eviction is performed. The lookup scans at most 5,001 documents and fails
at that bound instead of interpreting an incomplete scan as absence.
