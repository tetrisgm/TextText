# Ready-to-use folder workspace

Local WIP **0.202 (1120)** is installed at `/Applications/TextText.app`.
Core: `c340d11c`. Workspace UI: `8dbfbf6c`.

## Delivered

`/Users/shokunin/Documents/TextText` now contains nine actual folders: Notes,
Reading, Projects, Tasks, Journal, Writing, Gallery, Presentations, Templates.
There are 11 editable template packs and 11 example documents. Templates cover
note, article, bookmark, gallery, talk, timeline, case study, page, tasks, project,
and living brief. The app bundles and imports the checked-in complete packs,
including images and authoring source, with fresh document identities.

Workspace home shows actual folders, file counts, template cards, and documents.
Folder cards open their contents. Template cards create copies in the selected
folder or the template's suggested folder. The Templates folder holds the files
users and agents can edit. The picker is searchable and reloads after file events.
There is no template-network service or polling.

Setup is journaled, create-only and idempotent. Existing paths are preserved;
interrupted setup resumes; intentionally deleted starters stay deleted after
completed setup. Empty physical folders are included in native navigation.

## Verification

- Five focused Swift tests passed: real preset preservation, 22 distinct IDs,
  interrupted resume and user collisions, deletion preservation, symlink refusal,
  and empty-folder enumeration. Log: `/tmp/texttext-starter-tests.log`.
- Offline browser regression passed, including visible file templates and empty
  folder navigation, editing, external changes, cloning, conflicts, capture,
  search, rename/delete, and zero HTTP/fetch calls.
  Log: `/tmp/starter-browser-final.log`.
- Full TypeScript check and scoped ESLint passed. Light/dark overview screenshots
  inspected at `/tmp/texttext-starter-overview-{light,dark}.png`.
- Signed native build and all three extensions verified. Installer replaced the
  canonical app and launched build 1120. Logs:
  `/tmp/texttext-starter-build-final.log`, `/tmp/texttext-starter-install.log`.
- Installed WKWebView visibly showed nine folders and all 11 template cards.
  Clicking Gallery created `Gallery/Nights and weather 2.textpack`; the editor
  showed its four images. Non-Markdown archive entries matched the source pack
  byte-for-byte, with a different Markdown identity. The verification copy was
  then deleted through the recoverable app flow.
- Final workspace has 22 packs with 22 unique identities. All 22 matched the
  connected local server workspace byte-for-byte.

## Boundaries

This is a local desktop WIP, not a public release. No server restart, public
update, push, or persistent job was performed. The existing localhost server
still serves the prior capture-build UI; the new native library and its packs
are installed. Existing collaboration/capture limitations remain in HANDOFF.
The sandbox-private runtime health report was not used; installed UI and file
operations were verified directly. Multi-device first-time starter setup can
produce conflict copies if both devices independently seed before connecting;
existing conflict preservation applies. Setup does not erase occupied paths.
