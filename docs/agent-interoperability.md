# Agent interoperability

Texttext exposes one command surface to the in-app assistant and external MCP
clients. External clients connect to `https://texttext.app/api/mcp` with OAuth.
The app does not call its own MCP endpoint.

## Automation contract

- Read workspace and item state through MCP tools or MCP resources.
- Mutate content only through the shared workspace tools.
- Pass `if_match_hash` when changing an existing item.
- Pass a stable `idempotency_key` to `create_item` and `append_to_item`.
- Reuse that key after timeouts or reconnects.
- Ask before publishing, changing access, moving to Trash, or restoring content.
- Treat returned item IDs as durable references. Do not infer storage URLs.

## Project documents

Use one Texttext item per project. The repository URL or another durable project
identifier is the creation identity:

```text
project:<workspace-id>:<repository-url>
```

Append a dated Markdown section for each meaningful update. A commit SHA,
release version, or source event ID is the update identity:

```text
project-update:<workspace-id>:<repository-url>:<event-id>
```

This contract makes retries safe. A reconnect cannot create a second project
document or append the same release twice.

MCP hosts that support prompts can use `maintain_project_documents`. Hosts that
only support tools use `create_item`, retain the returned item ID, and call
`append_to_item` for later updates.

## Conversation capture

Use `capture_conversation` to save useful prompts, answers, decisions, and source
context as a portable Texttext note. The source conversation or message ID is
the stable creation key.

## Protocol surface

Resources:

- `texttext://agent-guide`
- `texttext://workspace`
- `texttext://items/{id}`

Prompts:

- `maintain_project_documents`
- `capture_conversation`
- `prepare_release_note`

All existing privacy, permission, audit, and draft rules remain below the MCP
layer. New tools and prompts do not bypass them.
