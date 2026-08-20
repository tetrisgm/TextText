---
description: Append one release entry to the matching TextText project changelog
---

Use the `project-changelog` skill and the local `texttext` command when it is
available. The skill resolves the command from PATH or the canonical TextText
app bundle and verifies it with a read before changing anything. Do not start an
MCP server or ask for a workspace token for local work.

Find the existing project changelog or create it once. Add the user-facing
release result exactly once, keep using the same item, and preserve concurrent
edits. Use hosted MCP idempotency keys only when hosted MCP is already connected.

Release context:

$ARGUMENTS
