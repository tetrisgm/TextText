# Agent interoperability

Texttext exposes one workspace command contract to the product UI, the in-app
assistant, and external agents. How an agent reaches that contract depends on
where it runs.

| Where the agent runs | How it works | Auth |
|---|---|---|
| On this Mac (Claude Code, Codex, a script) | The `texttext` CLI, editing documents as files | The device credential the app already holds |
| Anywhere else (Claude.ai, ChatGPT, Cursor, a phone) | Hosted MCP at `https://texttext.app/api/mcp` | OAuth, or a `wsk_` token from `/connect` |

The app never calls its own MCP endpoint. There is no loopback server: the local
MCP endpoint was retired in `0.146`, and with it the port, the transport guard,
and the whole local-trust problem.

## Agents on this Mac: the `texttext` CLI

An agent with a shell should edit files, not drive a protocol. The CLI ships
inside the app bundle (`mac/Sources/TexttextCLI`, copied to
`Texttext.app/Contents/MacOS/texttext` and signed with the app), so it is present
whenever the app is, and it runs as the user.

```text
texttext ls [folder]                     list documents
texttext read <doc> [--section "## H"]   print the body, or one section
texttext write <doc> [--from FILE]       replace the body (stdin by default)
texttext append <doc> [--from FILE]      append to the body
texttext edit <doc> --section "## H"     replace one section (stdin by default)
texttext open <doc> [--section "## H"]   open it in Texttext
texttext sections <doc>                  list the headings
texttext new <title> [--folder F]        create a document
texttext lint [<doc>]                    check documents are well formed
texttext install                         put texttext on your PATH
```

Global options: `--as NAME`, `--message TEXT`, `--from FILE`, `--section NAME`,
`--json`. Documents are addressed by workspace-relative path; a bare name works
when it matches exactly one document.

### Why there is no port, token, or pairing step

The app stores a device credential at
`~/Library/Application Support/Write/credentials.json` (mode 0600, a `wsk_` token
plus its origin). The CLI runs as the same user and reads it, so it is
authenticated by construction. Nothing to configure, nothing to paste, and no
listening socket for a web page to reach.

### Presence is automatic

Every mutating command publishes presence before it acts and clears it after,
through `POST /api/agent/presence`. The agent never has to remember to announce
itself.

```bash
texttext edit posts/launch.md --section "## Pricing" \
  --as codex --message "tighten the pricing copy"
```

While that runs, an open Texttext document shows Codex with its provider color,
anchored at the Pricing heading. Section anchoring is the right unit for an
agent: a human has a caret, an agent has a region of interest, and headings
survive edits above them.

The presence route derives workspace identity from the authenticated token,
never from the request body, so `--as` decorates a collaborator that is already
known to be this user's device. It cannot impersonate another account.

### Intent reaches the audit row

`--message` rides through to `action_audit`, so the record says that Codex
tightened the pricing copy rather than that something changed.

### Correctness guarantees

- **The CLI owns the `.textpack` format.** It reuses
  `WriteFileProviderKit/TextBundlePackage.swift` rather than reimplementing it,
  so frontmatter, `info.json`, and assets survive a round trip and an agent never
  touches the zip.
- **Writes are atomic.** The replacement is built in a temporary file and swapped
  in with `replaceItemAt`, a single rename. A crash leaves the previous document
  intact and the File Provider sees one complete replacement, never a partial
  file.
- **Section edits are surgical.** Only the addressed span changes, with canonical
  blank-line spacing re-emitted around it. Two agents in different sections of
  one document do not collide.
- **`texttext lint`** validates package structure, frontmatter, and asset
  references. It is the net that catches an agent which went around the CLI; a
  `PostToolUse` hook can block on it.

## Remote agents: hosted MCP

External clients connect to `https://texttext.app/api/mcp` with OAuth
(click-to-approve) or a manual `wsk_` token from `/connect`. `docs/mcp.md` is the
full protocol reference; `src/lib/ai/tools.ts` is the source of truth for tool
names and schemas.

### Automation contract

- Read workspace and item state through MCP tools or MCP resources.
- Mutate content only through the shared workspace tools.
- Pass `if_match_hash` when changing an existing item.
- Pass a stable `idempotency_key` to `create_item` and `append_to_item`.
- Reuse that key after timeouts or reconnects.
- Ask before publishing, changing access, moving to Trash, or restoring content.
- Treat returned item IDs as durable references. Do not infer storage URLs.

### Project documents

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

### Conversation capture

Use `capture_conversation` to save useful prompts, answers, decisions, and source
context as a portable Texttext note. The source conversation or message ID is
the stable creation key.

### Protocol surface

Resources:

- `texttext://agent-guide`
- `texttext://workspace`
- `texttext://items/{id}`

Prompts:

- `maintain_project_documents`
- `capture_conversation`
- `prepare_release_note`

## Invariants that hold for every surface

These live below the tool and file layers, so no transport can bypass them.

- `src/lib/store.ts` is the only content access boundary.
- Every mutation writes an `action_audit` row.
- Notes and bookmarks stay private and unlisted forever.
- Missing or unknown visibility means private.
- A delete means Move to Trash. There is no permanent delete on the shared
  surface.

## Release gate

`scripts/verify-agent-interoperability.ts` runs inside `npm run verify:release`.
It asserts the shared tool contract, the public agent docs, the CLI's bundling
and format ownership, atomic writes, automatic presence, the presence route's
token-derived identity, and that the loopback MCP server stays retired.
