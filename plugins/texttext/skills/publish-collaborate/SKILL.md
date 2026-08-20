---
name: publish-collaborate
description: Reshape a TextText draft, apply a validated template, publish it, and manage collaborators safely. Trigger when the user wants a finished public page, a shared editing link, comments, or account-based access.
---

# Publish and collaborate

Resolve `TEXTTEXT_CMD` from `texttext` on PATH, then fall back to
`/Applications/TextText.app/Contents/Helpers/texttext`. Verify it with
`"$TEXTTEXT_CMD" ls`, then use it to read and reshape the draft. Publishing,
access, comments, templates, and Trash require hosted MCP because they have no
file equivalent. Use those tools only when they are already connected. If they
are unavailable, finish the draft locally and explain that publishing is the
separate remote connection path instead of asking for a token mid-task.

1. Read the item and inspect available templates before changing its look.
2. Preserve the document's content while applying a template or constrained
   template operations.
3. Read the result and show the user the final title, template, and proposed
   audience before publishing or granting access.
4. Use `set_item_status` only for blog items. Notes and bookmarks remain
   unlisted.
5. Use `set_access` for named collaborators and the least powerful role that
   satisfies the request.
6. Use comments for review feedback instead of rewriting content when the user
   asks for suggestions or annotations.
7. Read the item and access list after changes, then report the durable URL and
   effective audience.

Treat publish, unpublish, access grants, revocation, and Trash actions as
important actions. Do not perform them from an ambiguous request.
