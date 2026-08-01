---
name: live-document
description: Use one TextText item as a live shared canvas while the user and an agent work together. Trigger when the user wants to watch a document develop, co-write in TextText, or keep a durable project document current throughout a task.
---

# Use a live TextText document

## With the `texttext` CLI

This skill is what the CLI is built for: the person watches the document change
while you work in it.

```sh
texttext open "<doc>" --as codex           # put it on their screen
texttext edit "<doc>" --section "## Plan" --as codex --message "draft the plan"
```

Passing `--as` is what makes you appear in the document with your own name and
colour, anchored at the section you are editing. Keep working section by section
so the person can watch progress arrive in place, rather than the whole document
being replaced under them.

Re-read before each write. The person is editing the same document at the same
time, and their changes must survive yours.

## With MCP, when the CLI is not available

1. Call `get_workspace`, then `list_folders`.
2. Search for the document by project identity and title before creating it.
3. Create the item only when no correct match exists. Use a stable
   `idempotency_key` based on the project and purpose.
4. Call `open_item` with that exact item id and `mode: "edit"`. On macOS, launch
   the returned `native_url` with the system `open` command. Do not ask the user
   to find the workspace, folder, or document manually.
5. Keep the returned item id for the rest of the task. The open document shows
   the agent identity, cursor, selection, and mutations as they happen.
6. Use `update_item` for deliberate revisions and `append_to_item` for durable
   milestones. Give every retryable append a stable `idempotency_key`.
7. Preserve concurrent human edits. If a guarded update conflicts, read the
   latest item and reconcile instead of replacing it with stale content.
8. Keep the item useful as a standalone document. Do not paste raw chat logs or
   internal reasoning unless the user asks for them.

Open TextText editors and agent mutations share the same collaborative document.
Do not create a detached replacement because the document is currently open.
