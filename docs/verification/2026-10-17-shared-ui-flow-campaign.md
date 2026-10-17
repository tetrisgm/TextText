# Shared UI flow campaign

Date: October 17, 2026. Scope: bounded T19 Chromium component/application fixtures on the Mac. **T19 is not complete.** These runs used intercepted test origins or an in-memory native bridge; they made no production content or account changes. They do not establish installed WKWebView, WebView2, Safari, OS clipboard, or real authenticated-account behavior.

## Source and method

The six initial focused scripts below built current source into isolated temporary outputs and ran sequentially, each with a 120-second process limit. Application source includes the share/access correction `0408e057` and publication/presence correction `05b32acb`. Two stale fixture expectations were corrected after inspecting their failures. The wider application run also exposed a real tag-projection defect, subsequently corrected and verified in a focused production-component regression below.

The broader `verify-browser.mjs` application fixture was attempted separately with a fresh `main.tsx` bundle in a temporary directory. Its copied harness changed only the bundle path and `createRequire` base so original relative dependencies still resolve; a temporary `node_modules` symlink resolved package imports. It did not overwrite `mac/build/LocalVault`. Build took 0.54 seconds. The application run had a 240-second process limit and failed at an assertion after 49.8 seconds.

- HEAD when this isolated bundle was built: `bde09b70090e762a4a18dd2ebb9ee6f5b10fb76b`, with the publication/presence source changes subsequently committed as `05b32acb`.
- `app.js` SHA-256: `97b49e1e87d29478faab339f7689c82ba40ee56391293e873fd0fb8edddc457e`.
- Original broad harness SHA-256: `be597f444794c315c418aacfc17923f24c61c917d78bafcb49e578292d5abc94`.
- Local logs and result metadata: `/private/tmp/texttext-t19-flows-20261017/`. Temporary artifacts are local debugging evidence, not a shipped acceptance record.

## Results

Script paths are relative to `src/local-vault/__tests__/`.

| Flow / fixture | Result | What it establishes | Remaining boundary |
| --- | --- | --- | --- |
| `document-layout.browser.mjs` | Pass, 2.37 s | List/Cards contain the same items and open targets; layout survives reload and is isolated per workspace; refreshed titles update both layouts; light/dark and 390 px width; only preview reads | Real installed preference behavior and realistic large libraries |
| `folder-move.browser.mjs` | Pass after fixture correction, 1.83 s | Invalid descendants rejected; interrupted review retries retain the same staging key; light/dark dialog; move/workspace departure closes stale dialog | Actual proposal approval, server move, permissions and native filesystem effects |
| `workspace-chooser.browser.mjs` | Pass, 1.28 s | Current workspace identity; unsaved-work guard; fresh denied access keeps editor/agent alive; successful full-page navigation | Native credential/account switching and real server grants |
| `gallery-comments.browser.mjs` | Pass, 1.64 s | Image-scoped comments and replies, draft isolation, historical file comments, zoom reset; real pack comment helpers behind a fake transport | Concurrent real accounts, revocation and installed persistence |
| `gallery-image-stage.browser.mjs` | Pass, 3.67 s | Keyboard reaches image edges; synthetic pointer pan; caption updates preserve position; Fit and asset changes reset; light/dark/narrow | Physical gestures, native cursor behavior and large real assets |
| `verify-editor-image-paste.mjs` | Pass after fixture correction, 1.20 s | Synthetic PNG/GIF paste inserts Markdown and a continuation paragraph; exact original bytes and asset metadata survive TextPack encoding | Actual OS clipboard/paste and native file persistence |
| `note-tag-paste.browser.mjs` | Pass after product correction; fails with only that correction removed | Production `VaultApp` edits a body and mixed-case tag, flushes before image insertion, then writes through CAS; all emitted representation pairs are coherent and original PNG bytes survive | Installed account/file transports; full application campaign remains incomplete |
| `verify-browser.mjs` | **Partial, failed** | Completed preceding assertions for Command-K discovery/search/open/reopen, bookmark search, capture/image imports, and read-only recovery preview plus full retained-pack restore including unknown entries | Full script and later template/gallery/feed flows are not accepted; see failure below |

Rendered spot checks inspected the dark document list and light gallery comment panel. The scripts also capture light/dark variants. Gallery fixture images are deliberately 1×1 pixels; these screenshots are control/layout checks, not realistic image-library acceptance.

## Fixture corrections and application diagnosis

1. Folder move initially found one global alert after the simulated move. A temporary diagnostic copy captured its exact text: “The workspace access details are invalid.” The fake transport returned `{}` for the newly required `workspaceAccess` read. Supplying the existing owner access contract fixed the fixture, with the original no-alert assertion retained.
2. Image paste initially expected no trailing paragraph. `prepareEditorImagePaste` intentionally appends `\n\n` at the end so typing can continue below the image; this behavior was introduced in `898dd21c`. The fixture now expects that exact body. Its original PNG/GIF byte-equality assertions remain and pass.
3. The broader fixture timed out at `verify-browser.mjs:1728`, expecting the story editor's `textContent` to equal `Heading` after a link-formatting sequence and a fill. A diagnostic rerun passed that point but failed after 72.7 seconds at line 2829, waiting for the note body to contain `assets/Thought-photo.png` after choosing Image in the slash menu. A final bounded diagnostic reproduced the image failure after 46.45 seconds. The captured screen says “Save the current text before pasting an image.” and offers Retry save. DOM and saved pack retain the preceding checklist text; the saved asset list remains empty. The initial Heading failure did not recur in either diagnostic rerun. Diagnostic harnesses only add failure output and shorten those waits; original assertions remain.

   Local evidence: `broad-browser.log`, `broad-diagnostic.log`, `broad-final-diagnostic.log`, and the inspected `note-image-failure.png` in the campaign log directory. No assertion was removed to obtain a broad pass, and no broad pass is claimed.

### Tag-projection root cause and bounded correction

A temporary instrumented bundle logged request/hash/error metadata around the save, without changing product source. Both CAS writes succeeded (`117 → 118 → 119`). Reading the second reply then threw `VaultRepresentationConflict`. The note editor authored `Ideas` in JSON while the Markdown renderer used the existing canonical tag helper and wrote `ideas`. The incoherent pair could not receive a fresh projection stamp; its retained earlier stamp correctly detected competing representations. The attachment guard stopped because the preceding save failed. This was a product authoring defect, not a mock CAS failure.

[`writePayload`](../../src/local-vault/model.ts) now normalizes top-level document tags before serializing **both** representations. It clones the input content; fields, body, assets and asset-specific tags are preserved. This is an authoring correction, not a read-time repair: representation conflict detection and save/paste guards remain unchanged.

- Three note/gallery/article regression cases in [`model.test.ts`](../../src/local-vault/model.test.ts) fail before the correction and pass afterward. They cover mixed-case duplicates, input immutability, other metadata/asset preservation, exact JSON/Markdown coherence and a fresh validated projection stamp.
- The focused [`note-tag-paste.browser.mjs`](../../src/local-vault/__tests__/note-tag-paste.browser.mjs) uses actual `VaultApp`/`VaultEditor`, a fake CAS transport, and synthetic image selection. It passes with current source. A temporary bundle with only the normalization line removed fails in 1.96 seconds with the same representation-conflict exception.
- Focused unit run: **41 passed, 1 skipped** across model, tag, paste and pack-projection tests. The skip is the existing optional historical client-1236 fixture, absent locally. Existing conflict tests still pass.
- Logs: `note-save-trace.log`, `tag-projection-before.log`, `tag-projection-after.log`, `tag-projection-focused.log`, `note-tag-paste-before.log`, and `note-tag-paste.log` in the campaign directory.

The full broad fixture has not been accepted after this correction. Server/agent writers that do not use `writePayload` need a separate canonical-tag audit; this receipt makes no claim about those paths.

## Still required

Run the installed T19 matrix on current coherent Mac/PC/web candidates. In particular, ordinary file import/export round trips, physical clipboard use, real account changes, concurrent comments, search invalidation after remote changes, and later broad-fixture flows remain open. Per-device List/Cards preference storage remains a documented product choice/gap; this campaign does not introduce cross-device preference synchronization.
