# T3: Mac capture agent + open markdown files with Write.app

Two Swift features in Write.app (SwiftPM, `mac/`). Both have WIRED SKELETON
files in this branch; you fill the implementations. AppDelegate already
calls you; do not touch it.

## File ownership (STRICT)

- You may edit ONLY: `mac/Sources/Write/CaptureAgent.swift`,
  `mac/Sources/Write/OpenFileHandler.swift`.
- You may CREATE: `mac/Sources/Write/BookmarkCaptureWebView.swift` (or
  similarly named new files under mac/Sources/Write/).
- NEVER touch: AppDelegate.swift, SyncEngine.swift, ServerClient.swift,
  ChangeListener.swift, Info.plist, StateStore.swift, anything else.
- Commit nothing. No network in your sandbox: build-verify only.

## Feature 1: the bookmark capture agent (CaptureAgent.swift)

Server contract (live in this branch):
- `GET {origin}/api/sync/v1/captures` with `Authorization: Bearer <token>`
  -> `{"captures": [{"id", "slug", "title", "url"}]}` (pending bookmarks).
- `PUT {origin}/api/sync/v1/captures/{id}` multipart/form-data fields:
  - `meta`: JSON string `{"url": final URL, "title"?, "siteName"?,
    "description"?, "capturedBy": "mac", "error"?}` (set `error` and omit
    artifacts to report a failed capture)
  - `readable`: string field, the readable extraction as markdown
  - `screenshot`: PNG file part (filename screenshot.png)
  - `html`: HTML file part (filename page.html)
  -> 200 `{item: {...}}`. Artifacts max 25 MB each.
- Credentials/origin exactly like ChangeListener.swift does it:
  `store.loadCredentials()` + `resolveServerOrigin(credentials:)`. Own
  URLSession; do NOT use ServerClient.

Implementation requirements:
- `poke()` is called from a background queue after every remote change and
  at launch. It must be reentrancy-safe (one drain at a time; a poke
  during a drain queues exactly one follow-up drain).
- Capture with an OFFSCREEN WKWebView. WKWebView is main-thread-only:
  hop to DispatchQueue.main for all web view work, do uploads off-main.
  Sequential, one page at a time. Per-page budget: 30s load + settle
  (~2s after didFinish for lazy content), then extract regardless.
- Readable extraction via injected JavaScript: title
  (og:title/document.title), site name (og:site_name), description
  (og:description/meta description), and body text: prefer
  document.querySelector("article"), fall back to main, then body;
  produce markdown as plain paragraphs (double newline separated),
  headline as `# {title}`, source line `[{host}]({url})` at top. Keep the
  JS defensive (try/catch, JSON-stringify the result).
- Original HTML via document.documentElement.outerHTML.
- Screenshot via WKWebView.takeSnapshot with a 1280x2000 max frame
  (configure the web view frame; full-page scrolling capture is NOT
  required, above-the-fold is fine for v1), PNG-encode via NSBitmapImageRep.
- Failure (load error, timeout, non-HTML): PUT meta with `error` so the
  server marks it failed; never crash the drain loop.
- Report progress through `onActivity?("captured <host>")` /
  `onActivity?("capture failed <host>: <reason>")`.
- Popups/JS dialogs: deny (implement the WKUIDelegate bits as no-ops).

## Feature 2: open .md files with Write.app (OpenFileHandler.swift)

Info.plist already declares markdown document types; AppDelegate already
forwards `application(_:open:)` to `OpenFileHandler.open(urls:store:syncRoot:)`.

- For each URL: if it is inside `syncRoot`, compute its relative path
  ("blog/ideas/my-post.md") and look it up in the sync index (see
  StateStore/SyncEngine for the entry shape: entries carry `relativePath`
  and the post id). Build the editor URL from three pieces:
  `resolveServerOrigin(credentials:)` for the origin, the blog handle from
  the workspace cache (`store.cachedWorkspace()`), and the file's slug
  (filename minus `.md`):
  `{origin}/t/{handle}/{slug}?edit=1&id={postId}`. Open it with
  NSWorkspace. That URL pattern is what the web post page expects for its
  edit mode; the id parameter lets the server redirect if the slug moved.
- Files outside syncRoot or with no index entry: return them as unhandled
  (AppDelegate reports politely).
- `isDefaultMarkdownApp()` / `setDefaultMarkdownApp(_:)`: use
  `NSWorkspace.shared.urlForApplication(toOpen:)` against a UTType for
  net.daringfireball.markdown to detect, and
  `NSWorkspace.shared.setDefaultApplication(at:toOpen:)` (macOS 12+ API,
  UTType variant) to set; when turning it OFF, reset to TextEdit
  (/System/Applications/TextEdit.app). These APIs may prompt the user;
  that is fine and expected.

## Conventions

Match the existing code style (read ChangeListener.swift and SyncEngine.swift
first). No em dashes anywhere including comments. Guard-let early returns.

## Verify

- `swift build --package-path mac` clean; that is your gate (no network,
  no GUI in the sandbox). In your summary, walk through the capture of one
  URL end to end and the open-with flow for a file at
  ~/Write/blog/ideas/hello.md.
