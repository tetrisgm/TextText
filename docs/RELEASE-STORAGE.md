# Mac release storage

Future signed Mac releases publish to a dedicated R2 bucket through the existing human-invoked `npm run ship`. This code does not provision a bucket/domain, fetch or change live credentials, publish a release, or move deleted Blob artifacts.

## Owner decision before the next release

Choose the public HTTPS download origin and set `TEXTTEXT_RELEASE_PUBLIC_BASE`. No hostname is invented or defaulted in code. The intended production setup is a custom download hostname attached to the dedicated R2 bucket; the zone must be in the same Cloudflare account. Cloudflare's `r2.dev` endpoint is development-only and rate-limited. A same-origin `/downloads/` proxy is an alternative, but that proxy is not implemented by this change. The release publisher verifies actual public bytes and stops if the selected origin does not serve them. See [Cloudflare public bucket documentation](https://developers.cloudflare.com/r2/buckets/public-buckets/).

The app keeps its existing product-domain `/appcast.xml` feed URL and `/download/TextText.zip` route. Sparkle's signed enclosure points directly to the immutable release object at the chosen download origin. Ordinary users need no Cloudflare account or credentials.

## Configuration

- `TEXTTEXT_R2_ACCOUNT_ID`: shared Cloudflare account ID.
- `TEXTTEXT_RELEASE_R2_BUCKET`: defaults to `texttext-releases`; separate from private media and backups.
- `TEXTTEXT_RELEASE_PUBLIC_BASE`: chosen public HTTPS origin, with no path/query/credentials.
- `TEXTTEXT_RELEASE_R2_ACCESS_KEY_ID` / `TEXTTEXT_RELEASE_R2_SECRET_ACCESS_KEY`: Object Read & Write credentials scoped only to the release bucket. The human release command obtains missing credential values through the existing login-Keychain helper. Media and backup credentials are never reused.

Only the release bucket should expose public downloads. Keep media and backup buckets private. These values/resources still require a separately authorized setup step. Nothing is installed as a job, hook, or watcher.

## Publication guarantees

The Mac release script validates configuration before bumping/building. The outer ship script validates it before its infrastructure steps. Local-only build/install paths do not need release storage.

1. Validate the signed appcast's version, build, arm64 requirement, exact immutable enclosure URL, archive length, and signature shape. The existing Mac release gate remains responsible for cryptographic Sparkle verification.
2. Stream/hash the local ZIP and upload `downloads/TextText-<version>.zip` with conditional creation. Retry only if an existing object has matching byte length and SHA-256 metadata; different bytes require a new version.
3. Stream the public ZIP back and check its exact byte count and SHA-256.
4. Publish and verify `downloads/appcast-<version>.xml` the same way.
5. Atomically replace `src/generated/app-release.ts`. The later web deployment switches the existing feed/download/version routes together.

No mutable aliases are required or uploaded. A failed public-domain check leaves the generated marker unchanged. Uploaded immutable objects may remain for a safe retry. The current historical generated manifest remains on disk as history, but application routes reject its deleted Vercel Blob URLs and return no available release until a real replacement is published.

Check the release storage contract with `node --test scripts/release-storage.test.mjs`. This uses fixture credentials and does not access a live bucket.
