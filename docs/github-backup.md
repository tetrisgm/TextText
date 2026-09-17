# GitHub backup

A copy of the workspace the person can read without TextText, in a
repository they own. Postgres stays the source of truth; the repository is
where the words go so they are never only in one database.

## What lands

Under `workspaces/<handle>/` on the chosen branch:

- one `.textpack` per authored item, at `<folder path>/<slug>.textpack`,
  the same zip the Mac app writes: `text.md`, `document.json`,
  `template.json` when the item pins a look, and `info.json`. Bytes are
  deterministic (fixed timestamps, stored entries), so an unchanged item
  yields the same git blob every run.
- `manifest.json`: schema `texttext.backup.v1`, the workspace name, the
  folder tree, and one entry per item with id, path, folder, slug, kind,
  title, status, updated time, sha256, and the git blob sha.
- `README.md`, written once when the repository is empty.

Feed-imported articles are not backed up: they are someone else's words and
come back from their feeds. Assets stay in blob storage and are referenced
by URL from the markdown and document.

## How a run goes

`src/lib/github/backup.server.ts`, `runBackup`:

1. Load every authored item with its document. Validate each against the
   document schema. The first failure aborts the run and is recorded as
   `failed` with the item named; a broken snapshot never lands.
2. Pack each item; compute its git blob sha locally.
3. Mint an installation token (`src/lib/github/app.server.ts`, RS256 app
   JWT, cached until a minute before expiry). No shared server secret can
   reach a repository.
4. Read the branch head and the previous manifest. Files whose blob sha the
   previous manifest recorded are named by sha in the new tree without an
   upload; changed and new files are uploaded as blobs; files the previous
   manifest listed that no longer exist are deleted from the tree. Nothing
   outside `workspaces/<handle>/` is touched because the tree is built on
   the head tree as base.
5. If nothing changed, no commit. Otherwise one commit on the branch, and
   the row records the commit sha, status, and a one-line detail.

An empty repository has no branch to build on, so the first run creates the
README through the Contents API and continues with the Git Data API.

## Schedule

Off, hourly, daily, or weekly, chosen in Settings, GitHub. There is no
scheduler. The workspace root mounts a heartbeat that asks the server once
per ten minutes of use whether a run is owed (`POST /api/github/backup`
with `action: "tick"`); `backupDue` answers from the row in one query. A
workspace nobody opens waits until someone does. If that is not enough for
a workspace, a persistent job that calls the same endpoint with an owner's
API token is the intended addition; the contract allows one for backups.

The previous manifest is read back from the repository, which anyone with
push can edit, so before it decides what to delete or fetch it is reduced
to entries under `workspaces/<handle>/` with a folder path and a
`.textpack` leaf the packer could have written. Choosing a public
repository requires an explicit confirmation, because notes and bookmarks
are unlisted by design and a public backup publishes them.

## Restore

Restore is import. Everything restored lands as a draft, whatever the file
said. `restoreBackup` reads the manifest from the repository,
and for every entry whose item id the workspace no longer has, downloads
the textpack, recreates missing subfolders by path, and creates the item
through the store the same way a synced file would arrive (new id, the
manifest's folder, the pack's document and look). Items that still exist
are left alone. Postgres is never overwritten from the repository.

## Settings and routes

- Settings, GitHub: Connect GitHub (see `sign-in-with-github.md`), then
  repository (from the ones the installation can push to), branch (default
  branch when empty), schedule, Back up now, Restore missing items, and the
  last run with a link to its commit.
- `GET /api/github/backup?handle=` lists pushable repositories.
- `POST /api/github/backup` with `action` settings, run, tick, or restore.
  Owner only.

## Audit

`github.set_backup`, `github.run_backup` (with the outcome), and
`github.restore_backup`, `github.restore_folder`, `github.restore_item`, all
on the workspace. Backup outcomes other than "unchanged" also go out as a
`github.backup` notification event to channels that want it.

## Verified

- `src/lib/github/__tests__/backup.test.ts`: first run uploads everything;
  a run with no changes commits nothing; a changed and a removed item cost
  exactly the changed blobs; an empty repository is bootstrapped.
- `src/lib/github/__tests__/backup.db.test.ts` (local Postgres): settings
  validation, a full run against an in-memory GitHub, the schema abort with
  nothing landing, and restore of a deleted item.
- Not verified here: a run against the real GitHub API with the live
  installation. The app JWT was verified against `GET /app`; the Git Data
  calls are exercised only through the in-memory fake.
