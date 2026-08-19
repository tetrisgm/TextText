---
name: texttext
description: Use TextText as the durable document home for notes, articles, bookmarks, project records, publishing, and collaboration. Trigger when the user asks to save, create, find, reshape, publish, share, comment on, or maintain TextText content.
---

# TextText

TextText is the source of truth for the documents it manages.

## Pick the transport first

**If the `texttext` command is available, use it.** It is the fastest path, it
owns the document format so an edit cannot corrupt a package, and it shows you in
the document as a named collaborator while you work.

```sh
texttext ls                                    # what is here
texttext sections <doc>                        # the headings
texttext read <doc> [--section "## Heading"]   # read all of it, or one section
texttext edit <doc> --section "## Heading" --as codex --message "why"
texttext write <doc> --as codex --message "why"    # replace the whole body
texttext append <doc> --as codex --message "why"   # add to the end
texttext open <doc>                            # open it in the app
```

Check with `command -v texttext`, and fall back to
`/Applications/TextText.app/Contents/Helpers/texttext` before giving up. The
sandboxed TestFlight edition intentionally excludes the command, so use hosted
MCP there.

Always pass `--as <your name>` and `--message "<what this change is for>"`. They
are how the person sees who is working and why, both live in the document and in
its history afterwards. Input comes from stdin, so pipe it or use `--from FILE`.

Prefer `--section` over rewriting a whole document: a section edit changes only
that span, so a person typing elsewhere is not disturbed.

**Use the MCP tools when the CLI is not available** (you are in a browser, on a
phone, or on another machine), or for work that has no file equivalent:
publishing, audience and sharing, comments, templates, and trash.

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
