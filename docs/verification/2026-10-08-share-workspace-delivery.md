# File workspace share delivery

Source `4734219c`, local signed Store candidate **0.204 build 1224** installed
at `/Applications/TextText.app`. No public release or website deployment.

## Failure and fix

Actual Safari share accepted a bookmark without producing a file. Startup
skipped inbox configuration after opening the file workspace window. Enabling
the watcher alone in 1223 did not resolve capture: the filer still targeted the
legacy server API. File-window capture now writes a complete TextPack through
the existing durable CLI creation journal and the normal file synchronizer.
The original inbox remains until successful publication. Unsupported append
and file shares remain retained, not silently consumed.

## Evidence

- Two new native regressions passed: retry after publication preserves identical
  bytes and identity; a deliberate second capture with the same title creates a
  separate file without overwriting; a different workspace cannot consume the
  original capture; unsupported append data stays in the inbox.
- Required exact-source sync gate passed: 848 shared tests and native durable
  file/session suites. Log `/tmp/texttext-4734219c-sync.log`.
- Signed build/install passed. Logs `/tmp/texttext-mac1224-build.log` and
  `/tmp/texttext-mac1224-install.log`. Runtime-health flag was not asserted;
  actual startup and capture were verified through the UI.
- Existing saved `Parent menu live verification 1218` reopened with its saved
  body intact. Signed-in real iCloud workspace unchanged.
- Actual Safari File > Share > TextText Share submitted public
  `https://example.com/?texttext-share=1224`, title `Safari share verification 1224`.
  While the app remained open, it created
  `Bookmarks/Safari share verification 1224.textpack` in the real iCloud root.
- Independent ZIP inspection confirmed bookmark identity
  `e06592ec-97c6-46e0-b17d-f2717252c987`, title and original URL.
- Native Command K found the new file immediately without restart; opening it
  showed the correct bookmark reader and original URL.
- Signed-in Safari opened the same identity on Oracle with the same title,
  Bookmarks path and original URL. This proves the fresh capture used normal
  file synchronization rather than a disconnected legacy create.

## Remaining scope

Append/file share implementations, Quick Look and File Provider interactive
acceptance, and the broader product readiness checks remain. The historical
1222 capture was not recovered into the workspace; no claim about that queued
record is made. The required existing project changelog artifact remains missing
from the previously inspected workspace roots; no duplicate was created.
