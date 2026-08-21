---
name: texttext
description: Use TextText as the durable document home for notes, articles, bookmarks, and project records. The signed-in local command captures, finds, reads, creates, and edits documents; an already connected hosted MCP adds publishing, sharing, comments, templates, and Trash. Trigger when the user asks to save, create, find, reshape, publish, share, comment on, or maintain TextText content.
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
"$TEXTTEXT_CMD" search "exact phrase" --json          # find matching content
"$TEXTTEXT_CMD" sections <doc>                        # the headings
"$TEXTTEXT_CMD" read <doc> --json                    # content and current hash
"$TEXTTEXT_CMD" edit <doc> --section "## Heading" --if-match-hash <hash> --as codex --message "why"
"$TEXTTEXT_CMD" write <doc> --if-match-hash <hash> --as codex --message "why"
"$TEXTTEXT_CMD" append <doc> --as codex --message "why"
"$TEXTTEXT_CMD" open <doc>                            # open it in the app
"$TEXTTEXT_CMD" new <title> --folder <folder>         # create a document
printf '%s' "one thing to keep" \
  | "$TEXTTEXT_CMD" capture --json --as codex \
      --message "Save this note" --idempotency-key <stable-key>
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
The plugin does not add hosted MCP itself. Never imply that the local command
can publish, share, comment, manage templates, or operate Trash.

## Find before inventory

For a simple find, retrieval, or "what did I write about" request, call
`texttext search "<query>" --json` directly. Do not list the workspace or poll
folders first. Search returns the same title, body, and excerpt matches as the
in-app assistant and hosted MCP, with an item id and snippet. Read the exact
result with `texttext read <id> --json`.

Use `texttext ls` only when the user actually asked for an inventory, when no
search term can be inferred, or when choosing among folders for a precise
creation request.

## Start with context

With the CLI: search for the relevant item, then use `texttext sections <id>`
and `texttext read <id> --json` before changing anything. Retain the returned
`hash` and pass it as `--if-match-hash` on the prepared write or section edit.

With MCP:

1. Call `get_workspace`.
2. Call `search` directly for a simple retrieval. Do not list folders first.
3. Call `list_folders` only before a precise create or when the user asked for
   workspace organization.
4. Read an item before changing it, and retain its content hash for guarded
   updates.

For a direct request such as "save this," do not make the user choose a folder
or document shape. With the CLI, pipe the exact content to `texttext capture`.
With hosted MCP, call `create_item` with `capture` and a stable
`idempotency_key`. TextText routes text to Notes and a URL to Bookmarks. Report
the returned receipt, then read the item back only when the user asked for
verification or the next step needs its content.

## Mutation rules

- Read an existing item before changing it. A new quick capture does not need a
  workspace inventory or an unrelated read first.
- For a CLI write or section edit, retain the `hash` from `read --json` and pass
  it as `--if-match-hash`. For MCP, use the corresponding `if_match_hash`.
- Pass a stable `--idempotency-key` to CLI capture, new, and append commands
  when an automation may retry. Use `idempotency_key` with MCP `create_item`
  and `append_to_item`.
- Use `if_match_hash` for guarded item mutations.
- Report the durable receipt after capture. Read the item back when the user
  asks for verification or the next step needs its content.
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
