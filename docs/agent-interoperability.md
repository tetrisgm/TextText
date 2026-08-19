# Agent interoperability

TextText exposes one workspace command contract to the product UI, the in-app
assistant, and external agents. How an agent reaches that contract depends on
where it runs.

| Where the agent runs | How it works | Auth |
|---|---|---|
| On this Mac with the standalone app (Claude Code, Codex, a script) | The `texttext` CLI, editing documents as files | The device credential the app already holds |
| Anywhere else (Claude.ai, ChatGPT, Cursor, a phone) | Hosted MCP at `https://texttext.app/api/mcp` | A `wsk_` workspace token from `/connect` |

The app never calls its own MCP endpoint. There is no loopback server: the local
MCP endpoint was retired in `0.146`, and with it the port, the transport guard,
and the whole local-trust problem.

## Agents on this Mac: the `texttext` CLI

An agent with a shell should edit files, not drive a protocol. The CLI ships
inside the standalone Developer ID app bundle (`mac/Sources/TextTextCLI`, copied
to `TextText.app/Contents/Helpers/texttext` and signed with the app), and it runs
as the user. The sandboxed TestFlight edition does not include the CLI because a
nested sandboxed command cannot reach the person's shell or the app's container.
TestFlight users connect a local agent through the hosted plugin or MCP path.

```text
texttext ls [folder]                     list documents
texttext read <doc> [--section "## H"]   print the body, or one section
texttext write <doc> [--from FILE]       replace the body (stdin by default)
texttext append <doc> [--from FILE]      append to the body
texttext edit <doc> --section "## H"     replace one section (stdin by default)
texttext open <doc> [--section "## H"]   open it in TextText
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
`~/Library/Application Support/TextText/credentials.json` (mode 0600, a `wsk_` token
plus its origin). The CLI runs as the same user and reads it, so it is
authenticated by construction. Nothing to configure, nothing to paste, and no
listening socket for a web page to reach. This applies to the standalone app and
its bundled CLI. It is not a promise that the TestFlight app installs a command.

### Presence is automatic

Every mutating command publishes presence before it acts and clears it after,
through `POST /api/agent/presence`. The agent never has to remember to announce
itself.

```bash
texttext edit posts/launch.md --section "## Pricing" \
  --as codex --message "tighten the pricing copy"
```

While that runs, an open TextText document shows Codex with its provider color,
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

- **The CLI owns the rich package formats.** It reuses
  `TextTextFileProviderKit/TextBundlePackage.swift` rather than reimplementing it,
  so frontmatter, `info.json`, and assets survive a round trip and an agent never
  touches the zip. Listing and addressing also cover `.textbundle`, `.md`, and
  `.txt`; the auxiliary `Data` attachment tree is not reported as documents.
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

External clients connect to `https://texttext.app/api/mcp` with a manual `wsk_`
workspace token from `/connect`. TextText does not implement an OAuth
authorization server, consent page, refresh token flow, or dynamic client
registration. A client must support a person-supplied bearer credential. The server
implements **MCP `2026-07-28`**, the stateless revision: no `initialize`, no
session header, no GET stream. Call `server/discover` to see what it supports.
`docs/mcp.md` is the full protocol reference; `src/lib/ai/tools.ts` is the source
of truth for tool names and schemas.

ChatGPT custom MCP availability depends on the person's plan, workspace role,
and administrator settings. A ChatGPT surface that requires OAuth cannot connect
to TextText's current token-only endpoint. Do not describe this as a universal
one-click ChatGPT connection. OpenAI's current availability and setup rules are
documented in its [developer mode and custom MCP app guide](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt).

## The assistant inside TextText

The standalone Developer ID app can launch the local Codex runtime and use an
eligible existing ChatGPT or Codex account. That path does not consume provider
API credits. The sandboxed TestFlight app cannot launch a command from the
person's home directory, so it cannot offer that embedded subscription path.

The API-key assistant works in the web product and both Mac channels. Provider
API billing is separate from ChatGPT and Claude consumer subscriptions. An
external agent connected over hosted MCP uses the account and model in that
external product; TextText receives only its workspace bearer token, not the
person's provider password or subscription credential.

### Automation contract

- Read workspace and item state through MCP tools or MCP resources.
- Mutate content only through the shared workspace tools.
- Pass `if_match_hash` when changing an existing item.
- Pass a stable `idempotency_key` to `create_item` and `append_to_item`.
- Reuse that key after timeouts or reconnects.
- Ask before publishing, changing access, moving to Trash, or restoring content.
- Treat returned item IDs as durable references. Do not infer storage URLs.

### Project documents

Use one TextText item per project. The repository URL or another durable project
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
context as a portable TextText note. The source conversation or message ID is
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

The live client gate starts a local server and runs
`scripts/test-token-mcp-loop.ts` against an isolated local workspace. It proves
missing and unknown tokens are rejected, a real workspace token can discover
the server and read its own workspace, revocation takes effect immediately,
and a replacement token works. The gate refuses non-local databases and removes
all scratch rows before it reports success.
