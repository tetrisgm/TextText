---
name: capture-conversation
description: Save a useful AI answer, prompt-response pair, or full conversation into TextText with source context and a clean title. Trigger when the user asks to keep, capture, archive, or turn the current discussion into a note or article.
---

# Capture a conversation

## With the local command

Resolve `TEXTTEXT_CMD` from `texttext` on PATH, then fall back to
`/Applications/TextText.app/Contents/Helpers/texttext`. Verify it with
`"$TEXTTEXT_CMD" ls` before continuing.

Distil the requested scope, then capture it directly. Put a clean title on the
first line and the useful content on following lines. TextText uses that first
line as the title without repeating it in the body.

```sh
"$TEXTTEXT_CMD" capture --json --from "<prepared capture file>" \
  --as codex --message "Capture the pricing discussion" \
  --idempotency-key "<stable conversation or task id>"
```

The receipt is authoritative: report its title, item id, and `saved_to`
location. Reuse the same idempotency key after a timeout. Do not inventory the
workspace or read the new item back unless the user asked for verification.
If the user specifically asked to add to an existing note, search for it, read
the exact result with `--json`, retain its hash, and use a guarded edit instead.

## With MCP, when it is already connected

1. Distill the requested scope:
   - Preserve the user's original question or goal.
   - Preserve the useful answer, decisions, and unresolved questions.
   - Remove chat filler unless the user asks for a transcript.
   - Include the source client and capture date in the body.
2. Call `create_item` with `capture` and a stable idempotency key derived from
   the conversation or task identifier. Do not list folders first.
3. Return the authoritative receipt. Read the item only when the user asked
   for verification or a next step needs its content.

Do not publish the capture unless the user explicitly asks. If the user wants a
verbatim excerpt, preserve it as quoted markdown rather than paraphrasing.
