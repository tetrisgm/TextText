---
name: texttext
description: Use TextText as the durable document home for notes, articles, bookmarks, project records, publishing, and collaboration. Trigger when the user asks to save, create, find, reshape, publish, share, comment on, or maintain TextText content.
---

# TextText

TextText is the source of truth for the documents it manages.

## Use the local command first

Resolve the command before doing anything else:

```sh
if command -v texttext >/dev/null 2>&1; then
  TEXTTEXT_CMD="$(command -v texttext)"
elif test -x /Applications/TextText.app/Contents/Helpers/texttext; then
  TEXTTEXT_CMD=/Applications/TextText.app/Contents/Helpers/texttext
else
  echo "TextText command not found"
fi
```

When `TEXTTEXT_CMD` is set, verify the connection with the harmless read
`"$TEXTTEXT_CMD" ls`. Use that same resolved command for the rest of the task.
Do not start MCP, request a workspace token, or ask the user to relaunch the
agent from a special Terminal session.

The command owns the document format so an edit cannot corrupt a package.
During a connected edit, TextText may show short-lived collaborator presence.
The durable action audit records the supplied agent name and intent.

```sh
"$TEXTTEXT_CMD" ls                                    # what is here
"$TEXTTEXT_CMD" sections <doc>                        # the headings
"$TEXTTEXT_CMD" read <doc> [--section "## Heading"]   # all or one section
"$TEXTTEXT_CMD" edit <doc> --section "## Heading" --as codex --message "why"
"$TEXTTEXT_CMD" write <doc> --as codex --message "why"
"$TEXTTEXT_CMD" append <doc> --as codex --message "why"
"$TEXTTEXT_CMD" open <doc>                            # open it in the app
"$TEXTTEXT_CMD" new <title> --folder <folder>         # create a document
```

Always pass `--as <your name>` and `--message "<what this change is for>"`.
They label the durable action audit, and may also label best-effort presence
while the edit is connected. Input comes from stdin, so pipe it or use
`--from FILE`.

Prefer `--section` over rewriting a whole document because it narrows the
intended change. If TextText reports a conflict, read the latest document,
merge only that section, and retry.

Use hosted MCP only when its tools are already connected and the local command
is unavailable, such as TestFlight, a browser, or another machine. Do not turn a
missing local app into a token setup flow. MCP also covers work that has no file
equivalent: publishing, audience and sharing, comments, templates, and Trash.

## Start with context

With the CLI: `texttext ls` to see what exists, then `texttext sections <doc>`
and `texttext read` before changing anything.

With MCP:

1. Call `get_workspace`.
2. Call `list_folders` before assuming folder paths.
3. Search before creating a document that may already exist.
4. Read an item before changing it, and retain its content hash for guarded
   updates.

## Mutation rules

- Read before you write, on either transport. Never replay content you have not
  just read.
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
