# Current Windows native write-receipt candidate

Frozen source `36c91bd2`. Actual PC build exited 0, including native Core and
Agent regressions, 336 shared-client tests across 38 files, TypeScript,
self-contained WPF packaging, and interactive desktop editor/close/file-activation
smoke checks. The source and artifact receipt was sealed by the Windows build.

Candidate:
`C:\Users\Shokunin\dev\texttext-client-36c91bd2\windows\build\candidate-a7e4fd75027d4e82a9752f809edaeb8d`.

Smoke receipts:
`C:\Users\Shokunin\dev\texttext-client-36c91bd2\windows\build\smoke-receipts-6e3a06ae109b4ceaa98ac5b2ed07d550`.

Mac-side log: `/tmp/texttext-windows-36c91bd2-build.log`.

The native checks include persisted creation after a lost acknowledgement,
receipt replay following a rename while retaining subsequent edits, refusal to
recreate a deleted identity, interrupted-completion recovery, preservation of
changed pending content, and rejection of future-version receipts. This is the
prepared-file operation layer; higher-level repeated agent creation remains a
separate requirement.

Not installed: the older installed TextText process (PID 44968) was still
responding before this build, and its unsaved state is unknown. The owner has a
pending save-and-close request. No force termination, installation, user-content
changes, or persistent build jobs were performed. Smoke checks used an isolated
workspace and are not proof of installed authentication, complete visual parity,
or production multiplayer convergence.
