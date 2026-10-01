# TextText handoff

## Current work

The owner requires ordinary folder workspaces, self-contained TextPacks, direct
agent file editing, and local/web conflict handling. Legacy migration is not a
prerequisite. See [architecture](design/texttext-file-vault-migration.md) and
[implementation and verification receipt](file-vault-implementation-2026-09-30.md).

Implemented on `main` in `76f373e1`, `f28500cd`, and `3b4549d6`: native folder
store/CLI, complete-pack filesystem server and durable sync, bundled shared
editor, file templates, and native assistant file tools. Local WIP **0.202 (1136)**
is installed at `/Applications/TextText.app`. Its selected workspace is
`/Users/shokunin/Documents/TextText`. Installed-app creation/save and a real
Codex append were verified against pack bytes and the refreshed editor. The
verification note was moved to recoverable vault Trash afterward.

The live remote-delete check found a stale editor; `0df00a1c` fixes clean closure
and preserves dirty drafts as separate copies. Both regression cases and the
installed Mac clean-deletion flow passed. See the receipt for exact evidence.

Capture/import/local full-text search are implemented and installed in build
1119. [Receipt](file-vault-capture-import-search-2026-09-30.md) records exact
behavior, tests, installed UI and web proof, and remaining capture limitations.
Commits: `4e7d4c56`, `587b06eb`.

The workspace now has nine real folders, 11 editable template packs and 11
starter documents. Native home exposes folders and template cards; creation
clones the complete file. Setup is resumable and preserves existing/deleted
files. Installed UI, gallery creation, 22 distinct identities and byte-identical
local-server convergence passed. See [starter receipt](file-vault-starters-2026-09-30.md).
Commits: `c340d11c`, `8dbfbf6c`.

## Active goal

Complete the full [product brief](design/texttext-content-first-ux.md), reconciled
with the file-vault architecture. Work remains in reference-quality daily
experiences, article enrichment/annotation, image capture, native customization,
multiplayer, feeds/publishing, and current-build performance. Prior architecture
receipts are historical evidence, not proof of new-path integration.

Article capture and personal notes now use the file-backed editor and guarded
saves. Installed native capture of a real public article and refresh preserving
notes passed. [Article receipt](file-vault-articles-2026-09-30.md) records scope,
tests, runtime and limitations. Commits `f3340047`, `88a7df47`.
Reader mode, rendered source comparison, and persistent quoted highlights are
implemented and browser-verified in `a3cb0637`, `c0a80b59`, now installed in 1127;
native pointer selection, painting, annotation and reopen persistence passed.
[Reader receipt](file-vault-reader-2026-09-30.md) records checks and corrects the
older capture fixture's premature expanded-browser claim. Native capture proof
remains valid. Image capture and native highlights are now verified below. Automatic capture still starts on
opening a saved link; an unopened-link queue remains pending.

Image import creates gallery packs with original image/GIF bytes and bounded
PNG still previews. Build 1124 installed native picker -> file -> reopened
gallery -> original viewer -> zoom passed; the generated fixture was deleted
recoverably. Native checks caught and fixed a missing WKUIDelegate picker and
invalid remote-asset mapping. Browser picker/drop/paste tests, nine unit tests
and TypeScript passed. [Image checkpoint](file-vault-images-2026-09-30.md).
Folder previews and an expandable, lazily loaded starter catalog are installed
in 1126. Cards use current text.md, bounded embedded-image thumbnails, a serial
request queue and 24-item pages. Fifteen checks, browser pagination, native build
and installed text previews passed. [Preview receipt](file-vault-previews-2026-09-30.md).

Installed review found missing embedded cover bytes in four starter types. The
repository packs now embed originals; eight provably unchanged installed copies
were repaired with their identities preserved and prior bytes kept in history.
All eight converged byte-for-byte with the local server. Native Gallery now shows
its actual image thumbnail. Build 1127 bundles the repaired packs. See the
[starter receipt](file-vault-starters-2026-09-30.md).
The general github/textpack.ts helper now preserves binary/opaque files and
info metadata on parse/edit/build, with bounded expansion and path/root checks.
Twenty focused tests (including the real gallery), TypeScript and scoped ESLint
passed; logs `/tmp/texttext-pack-roundtrip-{tests,tsc,eslint}.log`. Legacy GitHub
restore still creates database records and needs separate file-vault integration.
Live web image import, original viewer and bounded thumbnails passed against
the real local server. The imported pack converged byte-for-byte with native;
test deletion reached both replicas with history retained. See the
[image receipt](file-vault-images-2026-09-30.md). Native reader highlights also passed selection, painting, annotation, reopen
and byte-identical server convergence; the test annotation was removed.
Build 1129 includes validated native template proposals with schema feedback to
the agent. Real provider preview/refine/compare/Keep/reopen passed. Exact Markdown
and structured content were preserved, and the kept pack matches the server.
See [customization receipt](file-vault-customization-2026-09-30.md). Its disposable
Reading clone remains for inspection and should be deleted recoverably after
capturing the final screenshot.

Folder presentations now integrate ordinary marked definition files, three
presets, preview/keep/cancel, native assistant folder previews, shared collection
rendering, and bounded metadata-only transport. Model, server, Swift and browser
checks pass, including preserving every member and rejecting a concurrent design
change. See [folder view receipt](file-vault-folder-views-2026-09-30.md).
Installed 1132 completes the real native folder-agent preview/refine/restart
recovery/compare/Keep/reopen journey. Only Reading's design pack changed; all
member bytes stayed unchanged and the definition matches the local server.
Live schema feedback corrected the first invalid proposal. Binding-specific
query completeness and bounded cover projection fixes are in `54cc8c89`.
Web Gallery Contact sheet preview/Keep also passed, synced byte-for-byte to
native, and reopened with its image visible. See the folder receipt for logs
and screenshots. The remaining work includes full collaboration, publication,
recovery, large-collection indexing, visual polish and measured memory.

Recovery UI is installed and verified in 1134 (`579c1cdd`): Trash and recovery,
per-file Version history, saved-text preview and complete-pack restore as a new
identity. Real native and web restoration preserved all pack entries/assets,
changed only identity and converged byte-for-byte. Test copies were deleted
recoverably on both replicas. Native named Trash entries and selected-file
Escape dismissal passed after fixing duplicate React sibling keys. See the
[recovery receipt](file-vault-recovery-2026-09-30.md) for tests, bounds and evidence.
Guarded rollback onto an existing identity, large-history indexing, full backup
restore and the broader collaboration/publishing/performance scope remain open.

File-backed full-document Yjs merging and durable checkpoint/pack transactions
are implemented with concurrent-client, epoch-fence, deletion, audit and crash
recovery tests (`6ac655fb`). Named-workspace authenticated relay routes now enforce
read/edit roles and reauthorization after waits/uploads; local Postgres grant
revocation and scope tests pass. Editor/client/browser transport and bounded
native bridge are now implemented; current browser acceptance tests real
two-account typing, Undo/Redo, offline reconnection, idle mutation silence and
permission downgrade. See [collaboration checkpoint](file-vault-collaboration-2026-09-30.md).
Installed build is 1136. Native TextPack materialization and replayable
shared-edit journals are implemented (`2d1834b3`); 20 shared/sync and 47 document
store checks pass. Client and bridge integration also pass production web build
and two-account browser acceptance (`23758ecb`). Installed keyboard edits reached
the actual TextPack online and during server outage, survived quitting/reopening,
and converged to the server after reconnection with pending cleared. The
disposable `Untitled.textpack` (title `Shared file verification 1135`, identity
`2880a21d-7414-438d-a238-0e6cfcba98d9`) remains for recovery checks and recoverable
cleanup. A direct agent edit reached local/server copies but exposed a clean
reopen trap. Fixes `3a2b29b5` and `74c6e69b` pass five native bridge tests and the
production web build; native 1136 is installed and clean Reopen returned the
agent-edited file to an editable shared document. Its build/install logs are
`/tmp/texttext-{build,install}-1136.log`; Package.resolved was restored.
Pending conflict recovery also preserved both actual packs: original holds
`Agent concurrent branch 1136.`, recovered copy holds the human pending branch.
After Save a copy and reopen, the editor remained at its initial offline screen
with Retry/Edit local file despite restored server. Investigate active/visibility
and explicit retry; do not claim that final reopen journey complete. Both test
packs remain for verification and recoverable cleanup.
Same-origin independent journals now pass actual two-tab offline/reload/three-
editor convergence acceptance. Next: native recovery, scoped sharing, presence
and comments.

## Blockers and next work

- Owner's 2026-09-30 hosting direction: use Oracle for TextText; migrate media
  and off-box database backups from Vercel Blob to private Cloudflare R2 after
  the current work reaches the push/deployment stage. Preserve `a5bc87cb` and
  run checks with it. No Oracle changes or push have been made for this request.
  Before Oracle work, read `~/dev/algorave/deploy/oracle/README.md`: preserve
  Algorave's ports 5434/3500/8445, units, and both its `use_backend` rule and
  backend in `/etc/texttext/haproxy.cfg`; validate then gracefully reload with
  USR2 if that shared config changes. Preserve the existing pre-Algorave backup.
  R2 plan: `texttext-media` and `texttext-backups`, private access equivalent to
  today, bucket-scoped S3 credential, existing backup retention, complete copy
  with count/checksum verification, URL migration if needed, upload/read/real
  restore acceptance. Credential source is `~/.config/stack/cloudflare.env`;
  never log values.
- 2026-09-30 (evening): the owner decommissioned Vercel entirely. The `write`
  project and then the `write-media` Blob store were deleted on the owner's
  explicit decision after being told what it held: 1,665 files, 1.07 GB, as
  `captures/` (825), `documents/` (447), `downloads/` (382 Mac app zips that
  the Sparkle appcast enclosures point at), `editor/`, `releases/` and
  `backups/` (6 encrypted off-box database dumps). Nothing was copied first.
  Consequences to handle: document images at `*.blob.vercel-storage.com` URLs
  are gone; Mac app downloads and updates served from Blob are gone until
  re-hosted; the production backup service on Oracle still has
  `TEXTTEXT_BACKUP_UPLOAD=1` with the old token, so its remote upload will
  fail until the R2 `texttext-backups` target exists (local dumps continue).
  The R2 plan above is now a re-hosting task, not a migration. The Vercel team
  holds no projects or stores.

- Owner approved the local server switch. The replacement build now runs on
  localhost:3000 with `TEXTTEXT_VAULT_ROOT=.texttext/vault-server` (absolute
  runtime path), output `.texttext/vault-tab-journal-build`, build identity `texttext-vault-tab-journal-20260930` (exec session 78566). No persistent
  service job was installed. Inspect the listener before future restarts.
- Installed app connected with its existing account. Native create/upload,
  browser edit/download, server outage with local save and automatic recovery,
  byte-identical convergence, empty outbox, idle no-repeat-upload check, and
  web deletion reaching native with retained history all passed. The temporary
  verification file was deleted recoverably. The local account is the existing
  Mira Chen demo fixture; this does not verify public sign-in or deployment.
- Shared access/full live collaboration, browser assistant, full capture/import,
  publication, and retirement of legacy content callers remain integration work.
  Do not claim the entire earlier product plan is complete.
- The concurrent dependency worker committed upgrades in `a5bc87cb`; preserve that commit. No dependency changes were made for image capture.
- Preserve unrelated dirty `attachments.ts`, `tabs.test.ts`, and
  `scripts/.probe-editor.ts`. Starter asset repair is complete. Use sequential heavy
  checks and two Swift jobs. No persistent jobs were installed.

## References

The receipt links current tests and limitations. Earlier product work and proofs
are archived in [September 30 history](HANDOFF-history-2026-09-30.md) and
[the previous checkpoint](TEXTTEXT_UX_CHECKPOINT.md); their installed versions
and process identities are historical. Public deployment/release/push was not
performed. The brief requires a separate ask for those actions. Local app
replacement is authorized. No release changelog entry is due for this local WIP.
