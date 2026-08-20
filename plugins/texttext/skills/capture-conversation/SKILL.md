---
name: capture-conversation
description: Save a useful AI answer, prompt-response pair, or full conversation into TextText with source context and a clean title. Trigger when the user asks to keep, capture, archive, or turn the current discussion into a note or article.
---

# Capture a conversation

## With the local command

Resolve `TEXTTEXT_CMD` from `texttext` on PATH, then fall back to
`/Applications/TextText.app/Contents/Helpers/texttext`. Verify it with
`"$TEXTTEXT_CMD" ls` before continuing.

Distil the conversation as described below, then append it to an existing note
or create a new one:

```sh
"$TEXTTEXT_CMD" ls Notes                              # find a home for it
"$TEXTTEXT_CMD" new "<clean title>" --folder Notes    # create it when needed
"$TEXTTEXT_CMD" append "<doc>" --from /tmp/capture.md \
  --as codex --message "capture the pricing discussion"
```

## With MCP, when it is already connected

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
