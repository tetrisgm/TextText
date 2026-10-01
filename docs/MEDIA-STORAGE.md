# Private media storage

TextText media uploads use private Cloudflare R2 through the Node S3 client. No bucket public endpoint, presigned bearer URL, client credentials, or Vercel Blob fallback is used. Existing Blob objects were declared disposable; this change neither migrates nor contacts them.

## Runtime configuration

Set these server-only variables on the application host:

- `TEXTTEXT_R2_ACCOUNT_ID`: shared Cloudflare account ID (the same name as backups). Optional `R2_MEDIA_ACCOUNT_ID` overrides it for a separate account.
- `R2_MEDIA_BUCKET`: defaults to `texttext-media`, a dedicated private bucket separate from backups.
- `R2_MEDIA_ACCESS_KEY_ID` and `R2_MEDIA_SECRET_ACCESS_KEY`: Object Read & Write credentials scoped only to `texttext-media`. These are deliberately separate from `TEXTTEXT_R2_ACCESS_KEY_ID` / `TEXTTEXT_R2_SECRET_ACCESS_KEY`, which remain backup-only. Media runtime credentials must not be able to alter backups.
- `MEDIA_ORIGIN`: canonical application origin, such as `https://texttext.app`, with no path. Local tests may use `http://localhost:3000`.

Keep both R2 public access methods disabled. Browser CORS is unnecessary because uploads and reads pass through the app. Provisioning these resources, setting live secrets, and deploying remain separate steps; this code change performs none of them. See [Cloudflare's S3 SDK configuration](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).

## Access and paths

Objects are immutable random filenames under `media/v1/`. Stored document URLs point at `/api/media/...` on `MEDIA_ORIGIN`. The route checks current access before requesting R2 bytes. Published public items allow anonymous reads; private items require item access. Sync bearer tokens must belong to the same workspace. Responses are `private, no-store`, support a single byte range for video, and apply `nosniff` plus a sandbox CSP.

- `documents/{handle}/{itemId}/assets/...` and `captures/{handle}/{itemId}/...` authorize the item directly.
- Visual uploads use `documents/{handle}/visual/{uploadKey}/...`. The existing indexed idempotency record resolves the committed item ID, so URLs need no rewrite after item creation. Before commitment, only authenticated workspace editors may read the staging bytes.
- Legacy `/editor/upload` accepts `postId` alongside `handle` for item-scoped storage. Without `postId`, its `editor/media/{handle}/...` URL remains staging-only and can be read only by authenticated workspace editors. Saving that URL does **not** make it public. Legacy callers must supply an item ID before publishing those assets. There are currently no active `uploadMedia()` call sites. The folder vault uses embedded TextPack assets and is unaffected.

No document-body or full-workspace scan runs during a media read. Public media URLs should always use the canonical configured application origin, so private reads require its session cookie or a sync bearer token. Export clients downloading protected URLs must forward their authorized token; unauthenticated third-party fetchers cannot download private media.

## Bounds and cleanup

Uploads are limited to 50 MiB and image/video types. The adapter uses conditional creation, bounded retries/timeouts, streamed reads, and private prefix validation. Workspace deletion sweeps only that workspace's prefixes; unrelated origins, other-workspace references, legacy Blob URLs, and malformed paths are never deleted. Lists use bounded pages and reject repeated continuation tokens. Unbound staging objects remain until workspace deletion; an automated age-based purge is not installed.
