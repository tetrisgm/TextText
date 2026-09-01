# TextText

**Save anything. Bring your AI.**

TextText is a fast text workspace for people and AI agents. Capture a thought,
link, meeting note, draft, or useful AI answer in one motion. Then find it,
reshape it, organize it, or publish it from TextText, its in-app assistant, or
another authorized AI.

[Open TextText](https://texttext.app) ·
[Download for Mac](https://texttext.app/download) ·
[Connect an AI](https://texttext.app/docs/ai) ·
[Read the documentation](https://texttext.app/docs)

## The product loop

1. **Capture** without choosing a database schema or organizing first.
2. **Find** the same durable document from TextText or an authorized AI.
3. **Change** it with precise operations, visible attribution, and conflict
   guards.
4. **Review** consequential actions before they happen, then undo reversible
   work when needed.

TextText uses one validated document model. Notes, articles, bookmarks,
checklists, projects, galleries, newsletters, and custom AI-designed item types
are different presentations of the same portable content.

## What agents can do

The in-app assistant, the signed-in local `texttext` command, and the hosted MCP
server share one workspace-command surface. Depending on the granted scope, an
agent can:

- capture, search, read, create, append, and edit documents
- rename, tag, move, star, organize, restore, and inspect Trash
- work on a selected passage without replacing the rest of the document
- create and revise reusable item types from a plain-language description
- open documents and participate in live collaborative editing
- propose publishing, sharing, access, and permanent deletion for owner review

Every mutation is validated and attributed. Private content fails closed.
Publishing, access changes, Trash purges, and other consequential operations
cross explicit confirmation boundaries.

## Connect your AI

On the Mac, supported local agents use the signed-in `texttext` command that
ships with the standalone app:

```bash
texttext ls
texttext search "launch brief"
texttext read "Launch brief"
texttext do append_to_item --args '{"id":"...","markdown":"..."}'
```

Remote agents connect to the hosted MCP endpoint with a scoped workspace token:

```text
https://texttext.app/api/mcp
```

Create and revoke connections from TextText Settings. See the
[AI connection guide](https://texttext.app/docs/ai) and
[MCP reference](https://texttext.app/docs/mcp).

## Why TextText is different

- **Fast first.** Capture does not wait for organization or AI.
- **One source of truth.** The app and every supported agent operate on the
  same canonical document.
- **Agentic, not chat-shaped.** AI can perform exact document operations and
  return receipts, not merely suggest prose in a separate conversation.
- **Portable.** Export content as textpacks. The Mac app exposes the workspace
  through Finder and Spotlight.
- **Safe by construction.** Access is scoped, risky actions are reviewable,
  concurrent edits are fenced, and every mutation is audited.
- **Designed for reading and writing.** Documents can adopt polished reusable
  looks without turning content into arbitrary HTML or code.

## Current scope

TextText currently supports the web and Apple silicon Macs running macOS 14 or
later. The standalone Mac edition includes local agent connectivity and
automatic updates. The sandboxed App Store edition is built from the same
source but intentionally excludes local process launching and the command-line
helper.

The current product does not claim first-party Slack, Drive, Jira, mail, or
calendar connectors, semantic vector search, mobile apps, scheduled background
agents, or an arbitrary unattended batch runner.

## Architecture

- Next.js App Router and React
- Postgres with canonical schema-v1 document snapshots
- Yjs full-document collaboration with awareness and epoch fencing
- Native SwiftPM macOS shell with Share, Quick Look, and File Provider
  extensions
- One internal workspace-command surface used by the UI, assistant, CLI, and
  hosted MCP server

Start with [ARCHITECTURE.md](ARCHITECTURE.md), then read:

- [Agent interoperability](docs/agent-interoperability.md)
- [AI sidebar architecture](docs/ai-sidebar-architecture.md)
- [Document and item types](docs/document-types.md)
- [Security model](https://texttext.app/docs/security)
- [macOS File Provider](docs/file-provider.md)

## Run locally

Requirements:

- Node.js 22
- local Postgres
- Xcode and SwiftPM for the Mac app

```bash
npm install
bash scripts/setup-local-db.sh
npm run dev
```

The web app runs at `http://localhost:3000`. Development and tests must use the
local database configured in `.env.local`, never the production database.

Useful verification commands:

```bash
npm test
npm run lint
npm run build
npm run mac:test
```

## Project status

TextText is an active pre-1.0 product. The public repository makes the product
and its architecture inspectable, but no software license is granted until a
license file is added. Please use GitHub Issues for reproducible bugs and
security reports only when they contain no credentials or private document
content.
