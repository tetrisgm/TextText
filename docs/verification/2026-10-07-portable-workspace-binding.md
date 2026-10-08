# Portable workspace identity

Mac and Windows share `.texttext/workspace-binding.json`, with canonical JSON keys `version`, `origin`, `workspaceId`. Version 1 contains identity only. Credentials, outbox, cursor, recovery journals and editor state remain device-local.

The origin is normalized to lowercase scheme/host, no trailing slash and no default port. HTTPS is required except HTTP loopback development origins. Workspace identifiers retain case. Existing PascalCase Windows fields are readable for compatibility; writers use camelCase. Unknown versions, invalid origins, foreign workspace identities and malformed markers fail closed. A marker is a local binding hint, never proof of account authorization.

Mac writes after authenticated workspace discovery, checks an existing marker before journal migration/rebinding, and uses a flushed temporary file plus exclusive atomic rename. It never overwrites another binding. A copied folder can supply identity from this marker when this device has no sync journal. Legacy local journals remain compatible and must agree with an existing marker.

Markers are bounded to 4096 bytes; Mac checks regular-file metadata before a bounded read. Symlink paths and iCloud placeholder markers cannot be treated as a fresh absent identity.

Shared contract fixture: `sync/fixtures/workspace-binding.json`, consumed by Swift and Windows tests. Swift tests additionally cover repeated bind, foreign bind preservation, placeholder refusal, oversized input and symlinks. All tests use temporary folders; no active iCloud folder is changed by this implementation verification.
