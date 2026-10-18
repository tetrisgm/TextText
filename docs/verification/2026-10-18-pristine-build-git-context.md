# Pristine local build Git context

## Problem and scope

The private actor wrapper extracted a committed Git archive, but local gate and attestation commands require `git rev-parse HEAD`, `git diff` and `git ls-files`. A plain archive cannot satisfy those tools. The working repository has unrelated owner changes that must not be included in the candidate or overwritten.

The wrapper now creates independent Git metadata inside its fresh archive. A local depth-one fetch copies the selected commit, then `update-ref` and index-only `read-tree` bind the existing archived files to that commit. There is no source checkout/reset, worktree registration, remote, global `GIT_DIR`, linked common directory or shared object store. Empty local hooks, disabled fsmonitor and `push.default=nothing` are checked. The original repository is read only.

Before excluding `.git` from source enumeration, the verifier checks canonical containment, absence of metadata links/hardlinks/alternates/shared common directory, exact HEAD, exact index modes/blob IDs, allowed local configuration, no remotes and empty disabled hooks. Every tracked source file still has its bytes/mode/symlink target checked against the original selected commit. Unknown compilation inputs still fail verification.

The archive contains one create-only, zero-byte `.env.local` regular file. No credentials are copied. Existing guarded local PostgreSQL configuration is inherited in memory. The private Mac wrapper refuses absent or non-loopback database connections before creating the archive.

For the nested Oracle build helper only, `TEXTTEXT_LOCAL_DATABASE_INHERITED=1` permits the inherited loopback URL when that local file is exactly empty and regular with no symlink. Default behavior and nonempty files retain file precedence; remote connections, missing files and linked files refuse. The private Mac wrapper sets this flag only in its archive build child environment. This does not deploy or change Oracle configuration.

## Verification

`node --test sync/stress/artifact-source.test.mjs sync/stress/build-private-actor.test.mjs scripts/with-local-database.test.mjs` passed **24 tests**, zero failures/skips. Log: `/private/tmp/texttext-private-archive-git-localdb-final-20261018.log`.

Coverage includes dirty original source preservation, independent refs and clean archived Git identity, original HEAD preservation, tracked source/mode tampering, unexpected compilation files, altered index, remotes, common directory, alternates, configuration include, hooks, metadata/environment links, nonempty archive environment, fixed artifacts/create-only receipts, package-lock preservation and local database precedence/refusals. This is infrastructure fixture evidence, not a candidate build or acceptance result.

Source pins: `/private/tmp/texttext-private-archive-git-source-20261018.json`.

## Candidate sequence

1. Commit the final coherent source and resolve its full commit ID.
2. Call `preparePristineSource(repository, commit, freshDestination)` from the committed wrapper. Preserve `source.tar` and returned source proof.
3. Install locked dependencies inside the archive. Pass local PostgreSQL only through the existing primary checkout's guarded `with-local-database.mjs` process, without printing its value. In the archive child, use the explicit empty-file opt-in for nested helper calls.
4. Run the actual manual release gates in the archive, then the existing workflow capability and build-attestation commands. All receipt checks must bind the archive's exact source identity. Do not fabricate or reinterpret a failed receipt.
5. Build the normal Store-local candidate with explicit version/build, existing development signing and signed Codex runtime. Verify architecture/signature and isolated health. Preserve the signed normal app separately from any actor replacement.
6. Build/seal the private actor with the existing human-invoked wrapper, matching committed source and a sandbox-readable sidecar outside the signed app. Its trusted local receipt records actual fixed outputs; it is not cryptographic attestation or physical acceptance.

The required release command audit found only HEAD/diff/index-based Git reads. The historical upgrade harnesses are separate manual commands; shallow archive metadata does not claim historical source availability.
