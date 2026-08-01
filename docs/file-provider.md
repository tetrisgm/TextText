# TextText for macOS: File Provider status

This document records the File Provider architecture that is shipped in TextText.
It replaces the earlier implementation plan.

## Product contract

- TextText appears as one normal Location in the Finder sidebar.
- The root contains one folder per workspace and a separate `Data` tree for
  TextText-owned auxiliary files.
- Workspace folders contain the person's ordinary content documents.
- Every document is downloaded eagerly and kept on the Mac. TextText does not
  offer online-only files, eviction, or selective sync.
- Finder's File Provider state is authoritative for pending uploads, pending
  downloads, progress, and errors. The app does not invent a parallel badge.
- Server sync is independent from iCloud Drive. The user may back up or export
  files elsewhere, but two live sync engines never own the same File Provider
  tree.

## Native document formats

TextText-created rich documents use TextBundle packages. Their Markdown and
assets travel as one Finder item, so a workspace folder stays readable and is
not polluted by one visible asset folder per post.

TextText also opens and imports ordinary `.md` and `.txt` files. When an imported
plain file references assets, the plain file stays plain and its managed copies
live under:

```text
TextText/
  Data/
    Attachments/
      <workspace>/
        <document>/
          <asset files>
```

The `Data` hierarchy is read-only in Finder. TextText-created TextBundles remain
self-contained and do not also appear there.

Filenames are display metadata, not identity. Stable server IDs identify
documents, while filename encoding preserves unsupported filesystem characters
without changing the title shown in the app.

## Sync ownership

`NSFileProviderReplicatedExtension` owns the Finder surface. It uses the
existing authenticated `/api/sync/v1` contract for:

- workspace and folder enumeration
- document and artifact materialization
- edits with hash-based conflict checks
- create, rename, move, and delete for documents
- create and rename for folders
- change cursors and working-set invalidation

Folder move and folder delete are not advertised as Finder capabilities. Those
operations have workspace-level semantics and remain app actions.

The container app hands workspace origins and tokens to the extension through
the signed app-group and keychain handoff. Credentials never enter filenames,
Finder metadata, logs, health reports, or public URLs.

## Status and recovery

The app's Finder status monitor reads:

- `enumeratorForPendingItems()` for the pending count
- File Provider global upload progress
- File Provider global download progress
- provider availability and framework errors

The resulting states are `up to date`, `syncing`, `checking`, `not connected`,
or `needs attention`. The detail includes transfer percentages when Finder
provides them and states that all Markdown remains local.

File Provider versions include both representation and server hash. A format
change invalidates stale materializations without changing server identity.
Reimport adopts an existing item by stable ID, then by an unambiguous
parent-scoped filename or semantic title. This prevents a provider database
reset from creating duplicates.

The extension accepts legacy materialization markers and hides legacy bookmark
asset sidecars while Finder rolls old caches forward. New rich bookmarks and
posts materialize as TextBundles.

## Finder actions

Files expose these actions when a canonical public TextText page exists:

- `Copy TextText Link`
- `Share`
- `Manage Access`

The sync manifest carries two distinct URLs:

- `url`: authenticated content transport for File Provider
- `canonicalUrl`: public page used by Finder actions

The extension refuses `/api/sync/` transport endpoints as public links. Older
manifests that put a genuine public page in `url` remain compatible. Share and
Manage Access open the signed TextText app through a `texttext-app:` deep link; the
app validates the destination against its linked server origin before sharing
or loading access controls.

## Release and runtime checks

The app-owned health suite checks release identity and update configuration,
embedded extensions, private state persistence, sync-index decoding, workspace
storage, and Finder provider status. The same checks run:

- against the staged app before release publication
- on first launch of every version
- once per day
- on demand

Reports are stored locally before best-effort submission. They contain stable
check IDs and numeric metrics only. Health work never reloads the web view,
replaces optimistic client state, or blocks editing and sync.

## Provisioning

The shipped extension identifier is `app.texttext.mac.fileprovider`. It
uses the existing `group.app.texttext` app group and the checked local
Developer ID provisioning profile at:

`mac/profiles/TextText_FileProvider_Developer_ID.provisionprofile`

Release verification confirms the File Provider extension is embedded, signed,
and present in the staged app before any artifact is uploaded.
