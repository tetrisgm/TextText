# Oracle media storage

TextText stores uploaded images and video on the Oracle host. The bytes live outside application release directories and are never exposed as a static directory. Every read passes through the application authorization route.

## Runtime configuration

Set these server-only variables in the root-owned Oracle runtime environment:

- `TEXTTEXT_MEDIA_ROOT=/home/ubuntu/texttext/state/media`
- `MEDIA_ORIGIN=https://texttext.app`

The service account must own the media root. Keep it mode `0700`. The adapter creates object and metadata directories beneath it and writes files mode `0600`. Local development may use another absolute root and `http://localhost:3000`.

## Access and paths

Stored document URLs point at `/api/media/...` on `MEDIA_ORIGIN`. The route checks current item or workspace access before opening a file. Published public items allow anonymous reads; private items require item access. Sync bearer tokens must belong to the same workspace. Responses are `private, no-store`, support one byte range for video, and apply `nosniff` plus a sandbox CSP.

- `documents/{handle}/{itemId}/assets/...` and `captures/{handle}/{itemId}/...` authorize the item directly.
- Visual uploads use `documents/{handle}/visual/{uploadKey}/...`. The indexed idempotency record resolves the committed item ID, so URLs need no rewrite after item creation. Before commitment, only authenticated workspace editors may read the staging bytes.
- Legacy `/editor/upload` accepts `postId` alongside `handle` for item-scoped storage. Without `postId`, its `editor/media/{handle}/...` URL remains staging-only and only authenticated workspace editors may read it.
- Folder vault TextPacks keep their own embedded assets and do not use this directory.

No document-body or full-workspace scan runs during a media read. Export clients downloading protected URLs must forward their authorized token; third-party unauthenticated fetchers cannot download private media.

## Durability and cleanup

Uploads are limited to 50 MiB and image or video types. Each object gets a random immutable filename. The adapter writes and syncs a separate object and bounded metadata record, creates final names without replacement, refuses symbolic-link storage roots, validates every path segment, and checks stored size before streaming.

Workspace deletion sweeps only that workspace's prefixes. Pagination uses the last immutable key as its cursor, so deleting one page cannot skip the next. Unrelated origins, neighboring workspaces, deleted Blob URLs, query variants, and malformed paths are never removed. Unbound staging objects remain until workspace deletion; no background purge job is installed.

The Oracle database, media directory, release artifacts, and retained database dumps all share the same host under the owner's Oracle-only storage decision. Host loss therefore requires restoring from an Oracle infrastructure snapshot or another separately arranged Oracle copy; application-level retention alone does not provide an off-host recovery copy.
