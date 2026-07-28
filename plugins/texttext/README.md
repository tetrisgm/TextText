# Texttext for AI agents

Texttext gives Claude, Codex, ChatGPT, and other MCP clients one shared command
surface for durable notes, articles, bookmarks, project records, publishing,
and collaboration.

## Install in Claude Code

```sh
claude plugin marketplace add tetrisgm/write
claude plugin install texttext@texttext
```

Claude asks you to approve access to your Texttext workspace. The plugin includes
the Texttext MCP connection, five reusable skills, and two slash commands.

Use `/texttext:canvas project-name` to maintain one document while you work.
Use `/texttext:changelog release-details` to append a release exactly once.

## Install in Codex

```sh
codex plugin marketplace add tetrisgm/write
codex plugin add texttext@texttext
```

Codex asks you to approve access to your Texttext workspace. The plugin includes
the same MCP connection and skills as the Claude package.

## Connect ChatGPT

Open ChatGPT Settings, choose Apps, create a custom app, and enter:

```text
https://texttext.app/api/mcp
```

Choose OAuth and approve access in Texttext. No API token needs to be copied.

## Included skills

- `texttext`: create, find, reshape, publish, share, comment on, and maintain
  Texttext documents.
- `live-document`: use one open document as a shared canvas for human and agent
  edits.
- `capture-conversation`: turn a useful answer or discussion into a durable note.
- `project-changelog`: maintain one project record without duplicate entries.
- `publish-collaborate`: apply a validated look, publish safely, and manage
  collaborators.

## Other MCP clients

Use `https://texttext.app/api/mcp` as a remote MCP server with OAuth. Texttext
keeps authorization, content rules, and audit logging below the client-specific
integration layer.
