# Texttext for macOS: Apple platform plan

> **ARCHIVED / SHIPPED AND SUPERSEDED (historical record).** Phases 1 to 5
> shipped in v0.21 to v0.25. The workspace substrate has since moved from the
> iCloud-Drive-canonical design below to the macOS File Provider. For the
> current state see `docs/file-provider.md` and `docs/apple-workspace.md`.
> Nothing below is current project status.

> STATUS (updated 2026-07-15): SHIPPED and SUPERSEDED. Phases 1 to 5 shipped in
> v0.21 to v0.25, and the workspace substrate has since moved from the
> iCloud-Drive-canonical design below to the macOS File Provider (see
> docs/file-provider.md). This document is kept as the historical plan of
> record; the "First execution task (Phase 1)" section is complete, not pending.
> The only open Apple-platform work is File Provider Phase 5 (retire the native
> ~/Texttext mirror at a proven cutover).

Owner-approved plan of record (2026-07-12). This supersedes earlier
File Provider scaffolding plans. macOS only; the web product and backend
continue unchanged in their roles.

## 1. Product model

Texttext is a native macOS application backed by ordinary files. All
user-created content lives inside one Texttext folder in iCloud Drive:

```
iCloud Drive/
  Texttext/
    Blogs/
    Notes/
    Bookmarks/
    Drafts/
    Media/
```

This folder is the canonical workspace for the application. When the user
creates a blog, note, bookmark, article, page, or other Texttext object, Texttext
creates the corresponding files and folders inside this location.

Goals:

- files remain visible and accessible in Finder
- files synchronize automatically through iCloud
- files remain usable without Texttext
- Texttext does not invent a proprietary document database for content
- Texttext feels like a native macOS application rather than a wrapped web app

Texttext's backend remains relevant for: publishing to the web, public URLs,
collaboration, comments, account services, cross-platform access,
programmable modes, and agent access. The backend is NOT the primary file
store for the macOS application.

## 2. Canonical storage structure

```
Texttext/
  Blogs/
    <blog-handle>/
      blog.yaml
      Posts/
        first-post.md
      Media/
  Notes/
    product-ideas.md
  Bookmarks/
    2026/
      example-site.md
  Drafts/
  Media/
  .write/
    workspace.yaml
    index.sqlite
    state/
```

Rules:

1. Content remains represented by understandable files and folders.
2. Markdown is the default content format.
3. User content is not hidden inside CloudKit records or an opaque database.
4. Internal indexes and caches are rebuildable.
5. Moving or editing files in Finder should not corrupt the workspace.
6. Texttext should detect and reflect external file changes.

`.write/` may contain application metadata but never the only copy of
user-authored content.

## 3. iCloud Drive behavior

Use Apple's iCloud Documents support to place the workspace in iCloud
Drive. Rely on Apple for syncing, Finder integration, availability,
up/download status, file-system conflict handling, storage optimization,
and recovery. A document is a file URL; it may need materialization, but
the product never presents documents as remote records to download.

The application should: open files through coordinated file access, observe
file-system changes, request materialization when required, surface iCloud
activity or errors, save through standard document APIs, and avoid a second
canonical copy.

## 4. External folders and files

Texttext may open Markdown files and folders outside the workspace via the
standard document picker and security-scoped access: local folders,
external drives, network volumes, iCloud Drive, and third-party locations
exposed through Finder. No bespoke Dropbox/Google Drive/OneDrive
integrations.

## 5. CloudKit

Not required for document bodies or content sync. Only for a future feature
needing Apple-private structured data not naturally represented as files.
Do not introduce in the first implementation.

## 6. File Provider

Adopted as its own effort (this section previously deferred it). The workspace
now surfaces through a File Provider that makes Texttext a first-class Finder
sidebar location, under Locations, backed directly by the server. It replaces
the iCloud Drive/Texttext folder as the canonical local surface. See
`docs/file-provider.md` for the plan and current status.

## 7. macOS-only scope

No iPhone/iPad app, mobile document browser, mobile Share extension, mobile
App Intents, Live Activities, mobile sync, or mobile editor architecture.
Shared code may be structured sensibly, but no engineering effort on iOS.

## 8. Native editor

Use TextKit for the existing editing experience. Implementation change, not
a redesign: no new source mode, formatted mode, block editor, Notion-style
editor, new document format, or separate native editing model. Use
NSTextView, TextKit 2 where appropriate, native selection/keyboard/undo,
spelling and grammar, accessibility, standard macOS text interactions, and
Writing Tools.

## 9. Apple Writing Tools

Writing Tools work within the TextKit editor: proofreading, rewriting, tone
changes, summarization, key points, and transformations from Apple's
Writing Tools interface. Preserve structural Markdown and application
syntax; constrain or disable for YAML front matter, code blocks, inline
code, URLs, slugs, internal identifiers, machine-readable directives, and
embedded application syntax.

Acceptance: prose edits work and update the document, undo restores, the
Markdown stays valid, unsupported Macs get a normal editor, and no Texttext
server request is required.

## 10. App Intents

Expose document and publishing operations through App Intents. Maintain a
central human-editable capability manifest at
`WriteCore/Resources/AppCapabilities.yaml` (entities, intents, parameters,
result types, display names, availability, documentation).

Entities: Document, Folder, Blog, Publication, Bookmark.

Initial intents: Create document, Open document, Append text to document,
Search documents, Create folder, Move document, Create bookmark from URL,
Publish document, Unpublish document, Get recent documents. (No "Get
Today's Drafts".)

Generate from the manifest: CapabilityIdentifiers.swift,
CapabilityCatalog.swift, AppCapabilities.md, AppCapabilitiesTests.
The generator validates that every declared intent has an implementation.

## 11. Core Spotlight

Index the workspace: title, body text, content type, blog, folder path,
publication, modified date, publication state, keywords, published URL.
Deep-link into the relevant document. Update on save, external change,
move, rename, delete, and iCloud sync from another Mac. Do not index
`.write/` metadata as user content.

## 12. Share extension

macOS Share extension accepting selected text, URLs, web pages, images,
PDFs, and files. Actions: create note, create bookmark, create draft,
append to an existing document, save a file or image into the workspace.
Writes directly into the iCloud Drive Texttext folder; must not require the
full app to be running. Shared URLs become Markdown bookmarks with front
matter (type, url, created_at) plus optional selected text.

## 13. Quick Look

Quick Look support where Texttext introduces custom types or packages; good
rendered previews for Markdown (headings, paragraphs, lists, links,
quotes, code, images, front matter interpretation; hide non-article
metadata). No network access.

## 14. Live Activities

Not part of the macOS plan. Long-running operations use native progress
surfaces: toolbar progress, sidebar status, progress windows,
notifications, menu-bar state.

## 15. Apple Notes

Do not implement Apple Notes integration. Remove any Notes browsing,
editing, import automation, Apple Events integration, or Shortcuts-based
sync.

## 16. Repository structure (target)

```
Texttext/
  Apps/            WriteMac/ WriteWeb/
  Extensions/      WriteShareExtension/ WriteQuickLookPreview/ WriteQuickLookThumbnail/
  Packages/
    WriteCore/          Documents/ Markdown/ Workspace/ Blogs/ Bookmarks/ Publishing/ Resources/AppCapabilities.yaml
    WriteAppleStorage/  ICloudWorkspace/ FileCoordination/ SecurityScopedAccess/
    WriteEditor/        TextKit/ WritingTools/
    WriteAppIntents/
    WriteSpotlight/
    WritePublishing/
  Tools/           CapabilityGenerator/
  Tests/           WorkspaceTests/ MarkdownFixtures/ FileCoordinationTests/ AppIntentTests/ SpotlightTests/
```

Remove for now: WriteIOS, WriteFileProvider, WriteRemoteSync, CloudKit.

## 17. Implementation phases

### Phase 1: iCloud workspace foundation
macOS app owns one canonical Texttext folder in iCloud Drive; folder and file
structure for content; creation of notes, blogs, posts, bookmarks, drafts
as files; file coordination; iCloud sync handling; observation of external
changes; Finder-compatible rename/move/delete; rebuildable workspace index;
tests for file preservation and synchronization events.

Exit criteria: every content object exists as a file or folder in
`iCloud Drive/Texttext`; files readable outside Texttext; Finder changes appear
in Texttext and vice versa; iCloud sync does not require Texttext's backend; no
user content exists only in an opaque database.

### Phase 2: TextKit and Writing Tools
TextKit-backed editor preserving existing behavior; Writing Tools;
Markdown-sensitive constraints; native undo, spelling, keyboard,
accessibility.

### Phase 3: App Intents and Spotlight
AppCapabilities.yaml + generator + typed intents + generated docs/tests +
Spotlight indexing + deep links.

### Phase 4: Share extension and Quick Look

### Phase 5: Publishing integration
Connect local Markdown files to the publishing backend: stable identifiers,
publication metadata, upload/publish, published URL tracking, conflict
rules. Local iCloud files remain canonical; backend failure never blocks
local editing.

## 18. Explicit non-goals

iPhone/iPad apps, Apple Notes integration, provider-specific
Dropbox/Drive/OneDrive integrations, CloudKit document storage, a second file
sync system, editor mode redesign, block editor, proprietary document format,
Live Activities, PencilKit, Vision, real-time collaboration, complex merge
infrastructure.

File Provider is no longer a non-goal: it has been adopted as its own effort
(see `docs/file-provider.md`). CloudKit as the content backend stays a
genuine non-goal (the server is the backend). The File Provider replaces the
polling folder mirror rather than adding a second sync system; the native
mirror is retired at the cutover, not run alongside permanently.

## 19. First execution task (Phase 1, shipped)

Implement the iCloud workspace foundation for the existing macOS Texttext
application:

1. One canonical app-owned Texttext folder in iCloud Drive.
2. All Texttext content inside as ordinary files and directories.
3. Clear file structure for blogs, notes, bookmarks, drafts, media, and
   internal rebuildable metadata.
4. Markdown content as `.md` files.
5. Preserve existing application concepts; no editor or mode redesign.
6. Standard coordinated file access (NSFileCoordinator/NSFilePresenter).
7. Detect files created, edited, renamed, moved, or deleted outside Texttext.
8. Reflect those changes in the application.
9. Internal indexes rebuildable from disk.
10. Tests confirming no user-authored content exists solely in an internal
    database.
11. Tests for external edits and Finder operations.
12. Document the boundary between iCloud file sync, Texttext's local index,
    and Texttext's publishing backend.
13. Do not implement: CloudKit, File Provider, iOS/iPadOS, App Intents,
    Spotlight, Share extension, Quick Look, publishing sync, editor
    redesign.

The result must be a working macOS foundation, not an architecture
proposal.

## Verification

Evals for every phase and invariant of this plan live in
[apple-platform-evals.md](../apple-platform-evals.md). Run
`mac/scripts/apple-plan-eval.sh` for the acceptance matrix.
