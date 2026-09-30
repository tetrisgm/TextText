# File vault implementation, September 30, 2026

## Implemented

The Mac entry point now opens the bundled folder editor. Workspace documents
are actual `.textpack` files in a selected ordinary folder; local CLI selection
wins over any linked server credential. No hosted document API is needed to
read, create, edit, search, rename, or delete local content. The existing shared
renderer/editor is reused, with local Yjs history and no cloud presence poll.

Packs carry schema-v1 snapshots, Markdown, embedded templates/source, assets,
and stable identities. Saves preserve opaque archive entries. Cloning a
historical pack changes its identity before an atomic create-only publication,
retaining that exact version's assets and metadata. Folder selection has a
security bookmark; external edits trigger bounded filesystem events. Templates
can be copied from `Templates/`, applied, saved as independent packs, or used
as starter content. Assistant tools read/write the selected files directly,
fence writes by observed hash, and cancel queued mutations.

The optional sync actor journals operations before sending them. The server
stores complete packs in `TEXTTEXT_VAULT_ROOT/<workspaceId>`, with rebuildable
indexes, retained bases, operation receipts, and metadata audit replay. It
merges compatible snapshot/Markdown/asset changes, preserves conflicting
branches, and fences rename/delete by both revision and path. Tombstones
prevent stale resurrection; deletion retains recoverable bytes. Direct server
file additions, moves, and deletions are discovered from the folder. Native
and visible web clients hold a conditional change request; unchanged content
is not uploaded again. Hidden/offline browser tabs stop their request.

`/vault/[workspaceId]` uses the same UI over complete TextPack HTTP operations.
The local editor does not load the legacy hosted content shell. Legacy public
routes and feature callers remain for the currently deployed application.

## Verification

- Native CLI/document tests: creation, offline selection, stale saves, identity,
  assets, unknown ZIP entries, exact historical clones, rename/delete recovery.
- Ten native sync tests: idle traffic, interrupted operation replay, guarded
  downloads, server merges, conflicting edits, local/remote moves and deletions.
- Real WKWebView integration: create a file, open/edit/save it, then directly
  change its bytes outside the app and observe the update without a server.
- Three native assistant tool tests: local reads/writes, cancelled mutations,
  malformed template rejection.
- Real Swift HTTP transport against the TypeScript filesystem server: two
  folders exchange exact packs, merge offline changes, preserve conflicts and
  assets, propagate moves/deletions, and avoid repeat uploads while idle.
  Run with `TEXTTEXT_VAULT_HTTP_TEST=1`; fixture is temporary and loopback-only.
- 52 TypeScript tests across server, routes, reconciliation, model and transport.
- Both browser fixtures: local/offline file operations, custom template reuse,
  starter clones, conflicts, agent UI events, and web pack/asset preservation.
  Light/dark screenshots were inspected; an overlay hiding the sidebar was fixed.
- Full TypeScript check, targeted ESLint, and generated 11-preset check passed.
  Final isolated production web build and signed Mac build passed.
- Installed canonical `/Applications/TextText.app` version 0.202 (1117). Opened
  `/Users/shokunin/Documents/TextText`, created a note, saved a line, connected
  the existing Codex account, and requested an append. The actual pack bytes
  retained both lines and the editor refreshed to show the agent change. The
  temporary verification note was then moved to recoverable vault Trash.

Logs are under `/tmp/texttext-vault-*.log`; these are local verification outputs,
not source artifacts. No real credentials are used by the HTTP contract fixture.

## Remaining boundaries

Installed-app local folder and live agent checks passed. The owner subsequently
approved the local server switch. The replacement production build is running
on localhost:3000 with the filesystem root at `.texttext/vault-server` and
build identity `texttext-vault-local-20260930`. No public server/update channel
has changed and no persistent service job was installed.

## Activated-server verification

Using the installed app's existing local demo account and the real browser UI:

- Connected the selected folder and created/saved a note in the Mac app.
- Opened that same file in the web editor and saved another line; the native
  pack received it. No legacy content row was used for document bytes.
- Stopped the local server, saved another line locally, and restarted it.
  Automatic retry converged both packs byte for byte with an empty outbox.
- Reloaded the browser and verified all three lines survived.
- Compared server receipt/history counts during an idle interval: unchanged.
- Deleted the temporary test note from the web. Both active replicas removed
  it; native history retained its bytes and the outbox emptied.
- Re-ran 11 native sync/real-HTTP tests and 41 server/route tests: all passed.
  These cover lost-response replay, conflict copies, offline edit/delete races,
  conditional writes, access checks, server restart data, and asset retention.

Logs: `/tmp/texttext-vault-robustness.log`,
`/tmp/texttext-vault-server-robustness.log`, and
`/tmp/texttext-vault-server-3000.log`. Safari was signed out of the local test
account; the separate in-app browser already had the fixture session and was
used for the browser round trip. This proves the local connected data path,
not public account sign-in, hours-long memory stability, or every failure order.

## Remaining product integration

This file implementation does not yet replace every older product feature:
shared access and full live collaboration, browser assistant, capture/import,
publication, and retirement of legacy database content callers need integration
with the new store. History/conflict retention currently favors preservation
and has no automatic disk-pruning policy. Do not describe those as completed.
