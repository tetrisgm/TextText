# Mac release storage

Signed Mac release artifacts live on Oracle under `/home/ubuntu/texttext/release-artifacts`. This private durable directory is outside the timestamped application `releases/`, `incoming/`, and `current` paths, so application deploys and rollbacks do not replace it. The TextText service reads it as the existing `ubuntu` identity. The directory is mode `0700`; installed artifacts are mode `0600`.

Oracle serves only these immutable same-origin paths:

- `https://texttext.app/downloads/TextText-<version>.zip`
- `https://texttext.app/downloads/appcast-<version>.xml`

There is no release object store, public bucket, custom download domain, or release credential. The app keeps the stable `https://texttext.app/appcast.xml` feed and `/download/TextText.zip` link. The generated release marker selects one immutable appcast and ZIP pair, and Sparkle's signed enclosure points to the immutable ZIP route.

## Configuration

The human-invoked release uses the same Oracle destination and SSH identity as web deploys:

- `TEXTTEXT_PRODUCT_ORIGIN`, defaulted by `release/ship.sh` to `https://texttext.app`.
- `TEXTTEXT_ORACLE_HOST=ubuntu@<existing host>`, or the host saved in `~/.config/texttext/oracle-host`.
- `TEXTTEXT_ORACLE_ROOT`, which defaults to `/home/ubuntu/texttext`.
- `TEXTTEXT_STORAGE_MIN_FREE_BYTES`, which defaults to 2 GiB of free space after the incoming artifact is written.
- `~/.ssh/id_ed25519` with `IdentitiesOnly`, batch mode, and a bounded connection timeout.

The route defaults to `/home/ubuntu/texttext/release-artifacts`. `TEXTTEXT_RELEASE_ARTIFACT_ROOT` may select the corresponding absolute `release-artifacts` directory for another Oracle environment. In production it must remain under `/home/ubuntu` and outside deployment and backup directories. No runtime secret is needed.

## First cutover

The immutable route must be deployed before the publisher can read an artifact back through the product origin:

1. Run the normal human-invoked web-only release. The route safely answers `404` while the durable directory does not exist.
2. Verify an allowed absent filename and a malformed filename both answer an empty `404`.
3. Run the full release. The publisher creates the durable directory over SSH, transfers each artifact to a private random temporary name, and invokes the reviewed installer source over the same SSH session.
4. The installer independently checks available storage, server-side byte length, and SHA-256, then atomically hard-links the verified temporary file to its immutable filename. It reserves the configured free-space floor before transfer and rechecks it before installation. An identical existing file is accepted for retry; different existing bytes stop the release.
5. The publisher reads and hashes every byte through `https://texttext.app/downloads/...` before writing `src/generated/app-release.ts`. The later web deployment switches `/appcast.xml`, `/download/TextText.zip`, and `/api/app/version` together.

Nothing here installs a job, hook, watcher, credential, or automatic release.

## Delivery guarantees

The route accepts only the two dotted-numeric immutable filename patterns. It uses no user-provided filesystem path, refuses symlinked roots and files, and streams from an opened regular file without buffering the archive. Successful responses fix their own content type, include `nosniff`, and use `public, max-age=31536000, immutable`. It supports `GET`, metadata-only `HEAD`, and one RFC-style byte range for ZIP files. Missing directories and files return an empty `404`; invalid ranges return an empty `416`; operational failures return an empty `503` without filesystem details.

The publisher validates the signed appcast's version, build, arm64 requirement, exact same-origin enclosure URL, archive length, and signature shape before transfer. Remote installation is conditional and atomic. Failed same-origin verification leaves the generated marker unchanged. Verified immutable files may remain for a safe retry and are not pruned by application deploys.

Run the focused checks without contacting Oracle:

```sh
node --test scripts/release-storage.test.mjs scripts/release-version.test.mjs
npx vitest run src/lib/__tests__/release-download.test.ts 'src/app/downloads/[filename]/route.test.ts'
```
