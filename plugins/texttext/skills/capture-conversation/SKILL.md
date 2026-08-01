---
name: capture-conversation
description: Save a useful AI answer, prompt-response pair, or full conversation into TextText with source context and a clean title. Trigger when the user asks to keep, capture, archive, or turn the current discussion into a note or article.
---

# Capture a conversation

## With the `texttext` CLI

Distil the conversation as described below, then append it to an existing note or
write a new one:

```sh
texttext ls Notes                              # find a home for it
texttext append "<doc>" --from /tmp/capture.md \
  --as codex --message "capture the pricing discussion"
```

The CLI has no `new` command yet, so to start a fresh note use MCP's
`create_item`, then keep working on it with the CLI.

## With MCP

1. Call `list_folders` and choose the user's requested folder. Prefer a notes
   folder when the user does not specify one.
2. Search for an existing capture of the same topic before creating a duplicate.
3. Distill the requested scope:
   - Preserve the user's original question or goal.
   - Preserve the useful answer, decisions, and unresolved questions.
   - Remove chat filler unless the user asks for a transcript.
   - Include the source client and capture date in the body.
4. Create the item with a stable idempotency key derived from the conversation
   or task identifier.
5. Read the new item and return its title, folder, and TextText link.

Do not publish the capture unless the user explicitly asks. If the user wants a
verbatim excerpt, preserve it as quoted markdown rather than paraphrasing.
