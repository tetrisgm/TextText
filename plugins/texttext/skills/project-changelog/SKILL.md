---
name: project-changelog
description: Create or update a durable TextText project record and append user-facing changelog entries exactly once. Trigger after shipping project work, preparing releases, or when the user asks to maintain project notes.
---

# Maintain a project changelog

## With the `texttext` CLI, which is the fast path

```sh
texttext ls | grep -i changelog          # find it once
texttext sections "<the changelog>"      # entries are grouped by version
texttext read "<the changelog>" --section "## 0.143"
```

To add an entry, read the document, put the new version section on top, and
write it back in one go:

```sh
texttext read "<the changelog>" > /tmp/log.md
# prepend the new "## <version>" section to /tmp/log.md
texttext write "<the changelog>" --from /tmp/log.md \
  --as codex --message "0.144 changelog entry"
```

Newest on top is the rule, so a whole-body write is correct here. Use
`--section` when you are correcting an entry that already exists, since it
leaves every other entry untouched.

Read the document again before writing if any time has passed. Never write an
entry you have not just derived from the current content, or you will drop
someone else's.

## With MCP, when the CLI is not available

1. Call `list_folders`, then search for the project's existing changelog or
   project note.
2. If several matches exist, read them and use the one whose project identity
   matches the current repository or product.
3. Summarize user-facing results, not internal implementation noise.
4. Append a project-consistent entry using an `idempotency_key` based on the
   source commit or release identifier.
5. If no matching document exists, create one with a stable project title and
   the same idempotency key discipline.
6. Keep using the same item id for the life of the project.
7. If the document is open in TextText, the entry appears live and merges with
   the user's edits. Read it again only when confirmation or conflict recovery
   requires it.

Never create a second changelog only because a retry timed out. Do not publish a
private project record without explicit permission.
