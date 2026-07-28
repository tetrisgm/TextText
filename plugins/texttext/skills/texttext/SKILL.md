---
name: texttext
description: Use Texttext as the durable document home for notes, articles, bookmarks, project records, publishing, and collaboration. Trigger when the user asks to save, create, find, reshape, publish, share, comment on, or maintain Texttext content.
---

# Texttext

Use the Texttext MCP tools directly. Texttext is the source of truth for the
documents it manages.

## Start with context

1. Call `get_workspace`.
2. Call `list_folders` before assuming folder paths.
3. Search before creating a document that may already exist.
4. Read an item before changing it, and retain its content hash for guarded
   updates.

## Mutation rules

- Pass a stable `idempotency_key` to `create_item` and `append_to_item` when an
  automation may retry.
- Use `if_match_hash` for guarded item mutations.
- Read back the item after a mutation and report the durable result.
- Keep notes and bookmarks unlisted. Never try to publish them.
- Ask before publishing, changing audience, deleting, or revoking access unless
  the user already gave explicit permission for that exact action.
- Use Trash for deletion. Do not imply that `delete_item` or `delete_folder`
  permanently erases content.

## Common work

- Work in one open item with the `live-document` skill.
- Capture a useful answer with the `capture-conversation` skill.
- Maintain project records with the `project-changelog` skill.
- Shape and publish a finished document with the `publish-collaborate` skill.
- For document appearance, inspect available templates, apply a known template,
  or use constrained template operations. Do not invent HTML, CSS, or JavaScript.

## Failure handling

If a guarded mutation conflicts, read the item again and reconcile the user's
change with the current content. Do not blindly replay stale content. If a retry
follows a transport failure, reuse the same idempotency key.
