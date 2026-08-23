# Agent interoperability

TextText exposes one document model and one set of permission, validation,
audit, and conflict rules. How an agent reaches that model depends on where it
runs.

| Where the agent runs                 | Recommended path                                             | Authentication                                     |
| ------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------- |
| On this Mac with the standalone app  | Bundled `texttext` CLI through authenticated TextText routes | The signed-in app's device credential              |
| In a remote MCP client                | Hosted MCP at `https://texttext.app/api/mcp`                 | A revocable `wsk_` workspace token from `/connect` |
| In an explicit offline file workflow | `texttext` CLI with `TEXTTEXT_WORKSPACE_ROOT`                | Local filesystem permissions                       |

The app never calls its own MCP endpoint. The local plugin does not start a
server, use a loopback port, or ask the person to paste a workspace token.

## Agents on this Mac

The standalone Developer ID app ships the `texttext` CLI at
`/Applications/TextText.app/Contents/Helpers/texttext`. Claude Code and Codex
plugins package skills that call that command. Running `texttext install` links
the same signed helper into `~/.local/bin` when a shorter command is useful.

The sandboxed TestFlight app does not include the CLI. A TestFlight user can
still use the in-app API-key assistant or a remote client that supports hosted
MCP with a bearer credential.

```text
texttext ls [folder]                     list documents
texttext search <query>                  ranked title, excerpt, and body search
texttext read <doc> [--section "## H"]   print content; --json adds its hash
texttext write <doc> [--from FILE]       replace the body (stdin by default)
texttext append <doc> [--from FILE]      append to the body
texttext edit <doc> --section "## H"     replace one section (stdin by default)
texttext open <doc> [--section "## H"]   open it in TextText
texttext sections <doc>                  list headings
texttext new <title> [--folder F]        create a document
texttext capture [TEXT] [--folder F]     route text or a URL and return a receipt
texttext lint [<doc>]                    validate readable content
texttext install                         put texttext on PATH
```

Global options are `--as NAME`, `--message TEXT`, `--idempotency-key KEY`,
`--if-match-hash HASH`, `--from FILE`, `--section NAME`, and `--json`.
`--idempotency-key` applies to `capture`, `new`, and `append`; reuse the same
key after a timeout so retrying cannot create or append the same content twice.
`--if-match-hash` applies to `write` and `edit`; use the hash returned by the
JSON read that the prepared change was based on.

Documents are addressed by workspace-relative path. A bare name works only
when it matches exactly one document.

### Authentication and transport

The signed-in standalone app stores one tenant-scoped device credential. The
CLI reads that app-owned state and sends the credential only as a bearer token
to its validated TextText HTTPS origin. It never accepts a token in an argument
or environment variable, and it does not fall back to a File Provider mount.
Loopback HTTP is accepted only when the saved app state explicitly names a
development origin.

Workspace and manifest sync routes provide path discovery. Content reads,
creates, updates, and appends go through the authenticated
`/api/agent/commands` route, whose allowlist dispatches the matching shared
workspace commands. The local plugin does not gain comments, publishing,
collaborator management, or the rest of the hosted MCP surface through this
route.

### Identity, presence, and audit

The device credential authenticates the person and workspace. `--as` is a
bounded, self-declared agent label, not a second login or a security principal.
`--message` is optional intent metadata. Connected mutations keep the
authenticated account identity in the audit row and may add that agent label
and intent so the source of the change remains legible.

Commands with an item identity also publish short-lived, best-effort presence.
Presence can make the supplied agent label visible while work is in progress,
but it never authorizes an edit and never blocks a mutation if presence is
unavailable.

```bash
texttext read "Notes/Launch plan.textpack" --json
texttext edit "Notes/Launch plan.textpack" --section "## Pricing" \
  --if-match-hash "<hash from the read>" \
  --as Codex --message "Tighten the pricing copy"
```

### Connected correctness

- JSON reads return the current server document and version hash.
- Updates use that hash as a compare-and-swap guard. If the document changed,
  the CLI stops so the agent can reread and reconcile instead of overwriting
  concurrent work.
- When a person has the document open, the shared workspace command applies the
  edit through the live Yjs document path.
- Captures, creates, and appends accept `--idempotency-key`; the CLI also
  reuses its key for one bounded retry after a lost network response.
- A section edit computes an updated document and remains subject to the same
  whole-document version check. Two section edits can still conflict.

### Explicit offline mode

`TEXTTEXT_WORKSPACE_ROOT=/absolute/path` opts into the local file backend for
tests and intentional offline package work. In that mode the CLI preserves
TextText package structure and uses atomic local replacements. This is not the
default plugin path, does not use the signed-in server workspace, and does not
promise cloud presence, server audit rows, or live collaboration.

## Remote agents over hosted MCP

External clients connect to `https://texttext.app/api/mcp` with a manual `wsk_`
workspace token from `/connect`. TextText does not implement an OAuth
authorization server, consent page, refresh-token flow, or dynamic client
registration. A compatible client must let the person provide a bearer
credential. OAuth-only connectors cannot use this endpoint.

Hosted MCP exposes the complete shared tool contract, including comments,
guarded publishing, and collaborator management. Tool descriptions mark actions
that require confirmation; the client and agent are responsible for presenting
that confirmation before calling the tool. `docs/mcp.md` is the protocol
reference and `src/lib/ai/tools.ts` is the source of truth for tool names and
schemas.

### Bearer-capable client setup

Create one revocable workspace token at `/connect`. Keep the token itself in
the client's protected credential or environment manager, never in a repository
or command argument. These configurations contain only a credential reference.

Codex:

```sh
codex mcp add texttext --url https://texttext.app/api/mcp \
  --bearer-token-env-var TEXTTEXT_WORKSPACE_TOKEN
```

Claude Code project `.mcp.json`:

```json
{
  "mcpServers": {
    "texttext": {
      "type": "http",
      "url": "https://texttext.app/api/mcp",
      "headers": {
        "Authorization": "Bearer ${TEXTTEXT_WORKSPACE_TOKEN}"
      }
    }
  }
}
```

Cursor user or project `mcp.json`:

```json
{
  "mcpServers": {
    "texttext": {
      "url": "https://texttext.app/api/mcp",
      "headers": {
        "Authorization": "Bearer ${env:TEXTTEXT_WORKSPACE_TOKEN}"
      }
    }
  }
}
```

VS Code user `mcp.json` can prompt once and keep the value in secure storage:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "texttext-token",
      "description": "TextText workspace token",
      "password": true
    }
  ],
  "servers": {
    "texttext": {
      "type": "http",
      "url": "https://texttext.app/api/mcp",
      "headers": {
        "Authorization": "Bearer ${input:texttext-token}"
      }
    }
  }
}
```

Claude and Claude Desktop remote connectors currently accept authless or OAuth
servers, not a manually supplied bearer token. TextText does not currently
provide an OAuth authorization server, so that remote connector path is not
compatible today. On this Mac, use the token-free Claude Code plugin instead.

Every supported setup ends with the same proof: capture one private note with a
stable idempotency key, report its authoritative receipt title, item id, and
saved location, then read that exact item id back. Retry with the same key and
confirm that TextText returns the same item instead of creating a duplicate.

## The assistant inside TextText

The standalone Developer ID app can launch the local Codex runtime and use an
eligible ChatGPT or Codex account already available to it. The sandboxed
TestFlight app cannot launch that runtime.

The API-key assistant works in the web product and both Mac channels. Provider
API billing is separate from ChatGPT and Claude consumer subscriptions. An
external agent connected through hosted MCP uses the account and model in that
external product; TextText receives its workspace token, not the person's
provider password or subscription credential.

## Automation contracts

For the local CLI:

- Resolve an exact workspace-relative path before changing a document.
- Reread after a version conflict, reconcile, and retry deliberately.
- Retain the hash from `read --json` and pass it as `--if-match-hash` on a
  prepared whole-document write or section edit.
- Supply a stable `--idempotency-key` for retried `capture`, `new`, and
  `append` commands.
- Use `--as` and `--message` as honest display and intent metadata.
- Read back the changed document before reporting completion.

For hosted MCP:

- Read workspace and item state through MCP tools or resources.
- Pass `if_match_hash` when changing an existing item.
- Pass a stable `idempotency_key` to `create_item` and `append_to_item`.
- Reuse that key after timeouts or reconnects.
- Ask before publishing, changing access, moving to Trash, or restoring
  content.
- Treat returned item IDs as durable references. Do not infer storage URLs.

Use one TextText item per project. A repository URL or another durable project
identifier can serve as the creation identity, and a commit SHA, release
version, or source event ID can identify one changelog append. MCP hosts that
support prompts can use `maintain_project_documents`; other clients can retain
the returned item ID and call `append_to_item` with a stable idempotency key.

Use `capture_conversation` to save useful prompts, answers, decisions, and
source context as a portable TextText note.

## Invariants

Connected in-app, CLI, and hosted MCP operations share these boundaries:

- `src/lib/store.ts` is the content access boundary.
- Connected mutations write `action_audit`.
- Notes and bookmarks remain private and unlisted.
- Missing or unknown visibility means private.
- Delete means Move to Trash; the shared command surface has no permanent
  delete.

The explicit `TEXTTEXT_WORKSPACE_ROOT` offline mode is outside the connected
server path and therefore cannot claim server audit, presence, permissions, or
live collaboration.

## Verification

The release verifier and focused tests check the plugin package, the absence of
loopback MCP configuration, signed-in CLI routing, command allowlists,
idempotent create and append behavior, conflict handling, self-declared agent
metadata, and hosted MCP authentication. The live MCP loop runs only against an
isolated local workspace and refuses a non-local database.
