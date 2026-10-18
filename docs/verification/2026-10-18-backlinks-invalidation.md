# Open backlinks invalidation

## Scope

T15 focused shared UI correction. The open `VaultCardBacklinks` panel previously loaded only on click. A committed `texttext:vault-changed` event left source titles, excerpts and paths stale until manual close/reopen.

The panel now reloads on that event only while open. It captures its page-owned web transport (native requests retain the existing native bridge), and invalidates earlier reads on refresh, close, item change and unmount. It performs only search/read operations. No layout, durable content or provider behavior changes.

## Evidence

- Actual Chromium/React component regression failed on the original component while waiting for the changed source title: `/private/tmp/texttext-backlinks-invalidation-red-20261018.log`.
- `node src/local-vault/__tests__/backlinks-invalidation.browser.mjs` passes: `/private/tmp/texttext-backlinks-invalidation-green-20261018.log`. Covers text/title/path changes, deletion/restoration, exactly one search and source read per committed event, closed/idle inactivity, held-response cancellation by close/account remount, and no calls to a replacement workspace transport.
- Focused Vitest transport/search, folder collection and metadata cache suites: 3 files, 28 tests pass. `/private/tmp/texttext-derived-view-focused-20261018.log`.

The full local-vault suite also passes: 506 tests across 65 files, `/private/tmp/texttext-folder-backlinks-local-vault-full-20261018.log`; TypeScript passes in `/private/tmp/texttext-folder-shared-tsc-trash-20261018.log`.

Source SHA-256:

| Path | SHA-256 |
| --- | --- |
| `src/local-vault/VaultCardBacklinks.tsx` | `9b23aac8c865290ca7bd22a27e1a0467dbfed55cdd6cb715163022d38a803612` |
| `src/local-vault/__tests__/backlinks-invalidation.browser.mjs` | `c043c6ad3cc87d122c896f0e054952ad12aab93f403e933eebc0f60402564399` |

This is an actual component fixture with controlled transport data. It does not establish direct-filesystem, iCloud, native installed-app or six-client physical acceptance. Wider search/thumbnail/list and provider matrices remain open.
