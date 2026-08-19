# TextText for AI agents

TextText gives Claude, Codex, ChatGPT, and other MCP clients one shared command
surface for durable notes, articles, bookmarks, project records, publishing,
and collaboration.

## Connect your workspace

The plugin installer adds TextText's tools, but it cannot collect or store a
TextText credential. Claude Code and Codex read the same revocable workspace
token from `TEXTTEXT_WORKSPACE_TOKEN` when they start.

Create a token at `https://texttext.app/connect`. Then start either client from
the same terminal session:

```zsh
read -rs "TEXTTEXT_WORKSPACE_TOKEN?Paste your TextText token: "
printf '\n'
export TEXTTEXT_WORKSPACE_TOKEN
```

The hidden prompt keeps the token out of the command, shell history, and plugin
files. Close that terminal session or run `unset TEXTTEXT_WORKSPACE_TOKEN` when
you are done. You can revoke the token from TextText at any time.

## Install in Claude Code

```sh
claude plugin marketplace add tetrisgm/TextText
claude plugin install texttext@texttext
claude
```

Claude Code does not ask for a generic bearer token during plugin installation,
so set `TEXTTEXT_WORKSPACE_TOKEN` before starting it. The plugin includes the
TextText MCP connection, five reusable skills, and two slash commands. Open
`/mcp` after launch to confirm that `plugin:texttext:texttext` is connected.

Use `/texttext:canvas project-name` to maintain one document while you work.
Use `/texttext:changelog release-details` to append a release exactly once.

## Install in Codex

```sh
codex plugin marketplace add tetrisgm/TextText
codex plugin add texttext@texttext
codex
```

Codex does not ask for a generic bearer token during plugin installation, so
set `TEXTTEXT_WORKSPACE_TOKEN` before starting it. The plugin includes the same
MCP connection and skills as the Claude package. Open `/mcp` after launch to
confirm that `texttext` is connected.

## Connect ChatGPT

Open ChatGPT Settings, choose Apps, create a custom app, and enter:

```text
https://texttext.app/api/mcp
```

Choose bearer-token authentication if that option is available, then provide a
token created at `https://texttext.app/connect`. TextText does not currently run
an OAuth authorization server. ChatGPT custom-app availability and supported
authentication depend on the plan, workspace role, and administrator policy. An
OAuth-only ChatGPT surface cannot connect to TextText yet.

## Included skills

- `texttext`: create, find, reshape, publish, share, comment on, and maintain
  TextText documents.
- `live-document`: use one open document as a shared canvas for human and agent
  edits.
- `capture-conversation`: turn a useful answer or discussion into a durable note.
- `project-changelog`: maintain one project record without duplicate entries.
- `publish-collaborate`: apply a validated look, publish safely, and manage
  collaborators.

## Other MCP clients

Use `https://texttext.app/api/mcp` as a remote MCP server with a revocable
workspace bearer token from `https://texttext.app/connect`. TextText keeps
authorization, content rules, and audit logging below the client-specific
integration layer.
