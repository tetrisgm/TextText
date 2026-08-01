---
description: Append one release entry to the matching TextText project changelog
---

Use the TextText MCP tools and the `project-changelog` skill.

Find the existing project changelog or create it once. Append the user-facing
release result exactly once with a stable idempotency key derived from the
source commit or release identifier. Keep using the same item and preserve
concurrent edits.

Release context:

$ARGUMENTS
