---
name: project-changelog
description: Create or update a durable Texttext project record and append user-facing changelog entries exactly once. Trigger after shipping project work, preparing releases, or when the user asks to maintain project notes.
---

# Maintain a project changelog

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
7. If the document is open in Texttext, the entry appears live and merges with
   the user's edits. Read it again only when confirmation or conflict recovery
   requires it.

Never create a second changelog only because a retry timed out. Do not publish a
private project record without explicit permission.
