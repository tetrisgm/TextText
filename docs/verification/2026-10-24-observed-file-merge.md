# Observed file joins the open document

Cause: the native file watcher noticed changed TextPack bytes, but the open session only signaled a later checkpoint conflict. The existing TypeScript client already had a persisted-journal merge for external edits; this watcher path did not call it.

The watcher now tries that existing merge immediately after reading changed bytes. It retains the current identity and template-sidecar checks, and falls back to the existing checkpoint recovery when the merge refuses or parsing fails. The file reference advances only after an accepted merge. No native journal or recovery record was reset.

Focused regression: the watcher joins an ordinary agent file edit without a checkpoint conflict, and a refused merge retains the old file reference and signals recovery. Mac Node 22: TypeScript passes; 126 focused collaboration, watcher and connection-guide tests pass. PC TypeScript and focused collaboration/connection tests pass. No installed acceptance or release is claimed.
