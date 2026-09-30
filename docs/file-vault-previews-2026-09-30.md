# Folder preview checkpoint

Build **0.202 (1127)** is installed at `/Applications/TextText.app`.

Folder cards now request bounded metadata and still thumbnails through native
and web transports. Current text.md supplies title/body so direct agent edits
are reflected. Embedded images only; neither transport fetches remote pictures.
The client serializes requests across folder changes, skips abandoned queued
work, retains only the current page and shows 24 files per page. Failed previews
leave the original file accessible. No preview polling or persistent jobs.

Native ImageIO and server Sharp resize one image frame to at most 480 pixels,
with a 16-million-pixel input guard and bounded thumbnail response. The server
route authorizes through the existing vault boundary and `store.ts`. Complete
original assets are not returned to the grid.

The starter catalog is expandable, with its file metadata loaded only when
opened. Light/dark browser review caught the catalog obscuring files and a
single card stretching across the window; both were corrected.

## Verification

- Fifteen unit/API/transport checks passed, including preview authorization,
  current Markdown overriding stale JSON text, thumbnail dimensions, and
  invalid/remote images falling back to text. `/tmp/texttext-previews-tests.log`.
- Browser checks passed for previews, 24-item pagination, prior capture,
  reader and editing/conflict journeys. `/tmp/texttext-previews-browser.log`.
- TypeScript, scoped ESLint and native release compilation passed.
  `/tmp/texttext-previews-tsc.log`, `/tmp/texttext-previews-eslint.log`,
  `/tmp/texttext-previews-swift.log`.
- Build/install succeeded: `/tmp/texttext-build-1126.log`,
  `/tmp/texttext-install-1126.log`. Installed UI showed the collapsed catalog and
  readable text card in Gallery. Native image thumbnail verification subsequently passed after the starter
  correction below.

## Starter asset correction

Four image-bearing starter packs previously had remote cover references without
embedded bytes. Repository packs and eight unchanged installed copies now carry
the original assets. Native Gallery visibly renders the actual photo thumbnail.
See the [starter receipt](file-vault-starters-2026-09-30.md) for repair safeguards.
The general `github/textpack.ts` parse/build helpers now preserve binary and
opaque files plus extension metadata. Twenty focused tests include the real
gallery edit/rename roundtrip, path/root rejection and expansion limits.
This helper fix does not migrate the legacy GitHub database restore path.

Real web-server preview/image roundtrips passed; see the image receipt.
Native reader selection/persistence
and realistic long-run memory/performance remain open, alongside the rest of
the full product goal. The local server now runs the images build; no public
deployment or push was performed.
