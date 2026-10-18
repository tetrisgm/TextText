# CLI workspace root and transport routing

## Reproduced gaps

The installed `~/.local/bin/texttext` still resolves to the retained `source-ffbc83ee` command. It was not replaced. A separate current-source candidate built successfully in a private temporary directory and its `commands` invocation verified the existing account connection without exposing credentials. No acceptance item was created before the root/state audit.

The local CLI workspace API reconstructed stores at a document's parent directory. A real retained replacement conflict indexed at the selected root consequently did not fence a nested Notes document: read and identity lookup succeeded, and write, keyed append and section replacement changed the archive and created `Notes/.texttext` state. Two deterministic tests reproduced eleven failed assertions in `/private/tmp/texttext-cli-selected-root-red-final-20261018.log`.

Preserving the selected DocumentStore/root fixes those API calls and rejects local references outside that root. The nested regression then passed alongside all unchanged legacy DocumentStore tests. A separate routing fixture reproduced five failures because a selected account-connected workspace silently stayed on local files without verifying an unavailable, wrong-workspace or revoked account. Log: `/private/tmp/texttext-cli-upfront-routing-red-20261018.log`.

## Routing decision

- An explicit `TEXTTEXT_WORKSPACE_ROOT` is ordinary offline file mode. It does not imply authenticated account audit, presence, or access to the app's private guard state.
- A default selected workspace with a portable account binding verifies its existing origin/workspace connection up front, then uses one authenticated RemoteDocumentStore for the complete invocation. It does not combine a local read/hash with a remote mutation, and a network/account mismatch does not fall back to local files.
- A selected unowned local-only vault can remain local. With no selected vault, the existing signed-in remote path remains available.
- The entrypoint reports its chosen transport separately from machine-readable stdout.

The app-group state directory is not assumed accessible to an ordinary CLI process. The existing standalone credential handoff grants account commands, not permission to invent, merge or relocate app-private owner/recovery records. In particular, the selected real vault already has root and nested legacy `.texttext` directories, while its corresponding state directory is absent from the known legacy private base. No automatic adoption or metadata migration is authorized by that observation.

Local CLI metadata and leases must use a private CLI state base outside provider roots. Unknown legacy guards are refused and preserved. For retry-safe creation, metadata/private originals stay private; a fully verified archive may stage in a fixed hidden destination-volume content area before exclusive atomic publication. This content staging is not a synchronized credential, lock or journal.

## Private creation protocol

The explicit offline entrypoint configures `Application Support/TextText/CLI` (or `TEXTTEXT_STATE_DIR/CLI`), then `VaultDeviceState/<root hash>`. It refuses cloud-managed/workspace-contained bases, symlinked bases and unknown root or nested legacy guard directories. Known portable binding and retained history/conflict/trash copies grant no account authority. Direct library fixtures retain their existing default storage; this change does not silently migrate app state.

Private creation intent version 3 retains its complete original archive, request fingerprint and process lock outside the provider. Only a verified content archive stages at the destination parent's `.texttext/cli-creation-content/<item UUID>.textpack`, allowing publication on the destination volume. An immutable private publication-attempt receipt is flushed after staging and before exclusive rename. If the stage was consumed but the published identity is unavailable, retry refuses rather than recreating from the retained original. Existing in-root version 1/2 receipts retain their previous validation rules.

Publication checks the canonical root-relative destination parent, full staged hash and same volume, uses exclusive no-follow rename, and checks the published hash. Canonical system `/var` aliases are resolved for the syscall; a workspace-relative symlink ancestor is refused. This is local process retry protection, not a distributed provider lock or a claim that the offline CLI reads inaccessible app-group guards.

## Verification

The first all-CLI run preserved a real regression: seven existing creation tests failed because `RENAME_NOFOLLOW_ANY` encountered the system `/var` alias, and the new private-base fixture caught a missing-ancestor symlink. Log: `/private/tmp/texttext-cli-root-routing-core-second-20261018.log`. Canonical syscall parent binding and explicit existing-ancestor validation fixed both without relaxing the internal symlink refusal.

Final gate: `/private/tmp/texttext-cli-root-routing-core-final-20261018.log`, **134 tests, zero failures, zero skips**. This includes all 33 original DocumentStore and 23 RemoteDocumentStore tests, async selected-account verification and no-fallback fixtures, nested-root fences, legacy identityless writes, private-state policy, symlinked destination refusal, and a separate-process invocation of the freshly built CLI. The entrypoint fixture creates once and retries, verifies journals/locks/private originals stay outside the workspace, retains the published archive outside the workspace, then proves retry refuses to recreate it. No user content participates.

Exact eleven-source/artifact hashes: `/private/tmp/texttext-cli-root-routing-core-final-20261018-source.json`. The tested build artifact is `mac/.build/out/Products/Debug/texttext`, SHA256 `6f4e6e4dd1306472e3183ce0c27f49ae59f65e331943610004e1902a35571a7e`. `Package.resolved` was restored byte-for-byte (SHA256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`). The installed shim remains unchanged.

## Authenticated candidate acceptance

After source checkpoint `93aa90ae`, the exact tested executable was copied into the separate retained candidate directory `/var/folders/tq/_6yt1vp555qcj2jwgxmz060w0000gn/T/texttext-cli-verified-20261018-9seshxy5`. Its full relevant source inventory and artifact hash are retained in `source-artifact.json`. Its actual `commands` entrypoint verified the existing selected account and printed the explicit authenticated transport notice. Command names and arguments were taken from that response, not guessed.

A new dedicated draft Note was created through `do create_item` with a stable key: item `2a48bf3b-1d6c-4346-8152-618acc563664`, path `Notes/CLI acceptance 2026-10-18 b25376c4-2a48bf3b.textpack`. Actual separate invocations read it, applied a hash-guarded edit, read the new hash, appended with a stable key, retried the exact append request with its original hash, retried the original create, and read the result. Both append responses returned the same revision, the append occurs once, creation returned the same item, and the guarded edit survived. A separate edit with the old hash refused and left the final hash unchanged: `6fb27f2dc79704ea168d83b7a3988555726f410eb291ebd992f00fcee8614d1c`.

Every invocation supplied `--as codex` and a concrete `--message`; `acceptance-receipt.json` hashes all retained request/response files. This proves the authenticated command route and request attribution, not a separately queried live audit row or observed editor presence. The item remains a draft Note in Notes. No existing content, account, credentials, or selected local file was changed by these commands. The installed shim remains on `source-ffbc83ee`; no installed-CLI, public release, or final app acceptance is claimed.

## Local CLI delivery proposal

The current `install` command safely refuses to replace a symlink to a different helper. Preserve that guard. The established standalone delivery mechanism creates a new versioned private executable, retains the previous binary and exact source/artifact/install receipt, verifies the current command is the expected TextText symlink, then atomically swaps only that symlink. A final release candidate must be built after native source freezes and verified before this authorized local update. No update was performed in this slice.
