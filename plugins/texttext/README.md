# TextText for AI agents

TextText gives Claude and Codex a direct way to create and edit durable notes,
articles, bookmarks, and project records on the Mac.

## Before you install

Install the standalone TextText app at `/Applications/TextText.app` and sign in
once. The plugin uses the `texttext` command shipped inside that app. It does not
start an MCP server, ask for a workspace token, or depend on the Terminal session
that installed it.

The skills discover the command in this order:

```text
texttext
/Applications/TextText.app/Contents/Helpers/texttext
```

The first available command is verified with a read-only `texttext ls`. If you
want the short command available to every shell, run `texttext install` once.

## Install in Claude Code

```sh
claude plugin marketplace add tetrisgm/TextText
claude plugin install texttext@texttext
```

Restart Claude Code, then ask it to list your TextText workspace. The plugin
includes five reusable skills and two slash commands. No MCP connection or
credential setup is part of the local install.

Use `/texttext:canvas project-name` to maintain one document while you work.
Use `/texttext:changelog release-details` to append a release exactly once.

## Install in Codex

```sh
codex plugin marketplace add tetrisgm/TextText
codex plugin add texttext@texttext
```

Restart Codex, then ask it to list your TextText workspace. Codex uses the same
skills and the same bundled command as Claude Code. The install requires no
token and does not add a hosted MCP server to the session.

After either install, use the same visible connection proof:

> Use TextText to capture this private note with a stable idempotency key:
> Agent connection check, then a new line, then Connected through [your agent
> name], replacing the brackets with your name. Report the exact receipt title,
> item id, and saved location. Read that exact item id back, confirm the saved
> line, and do not publish or share it.

The first useful loop is three commands:

```sh
printf '%s' "Launch brief\n\nKeep evidence beside each claim." \
  | texttext capture --json --as Codex --message "Save the launch brief" \
      --idempotency-key "launch-brief:first-capture"
texttext search "launch brief evidence" --json
texttext read "<returned item id>" --json
```

Capture needs no folder inventory. Text goes to Notes, a lone URL goes to
Bookmarks, and the JSON receipt contains the authoritative title, item id, and
saved location. For multiline text, the first line becomes the title and the
following lines become the body, so the title is not repeated in the document.
Reuse the idempotency key after a timeout.

For retrieval, ask "find my notes about pricing." The plugin calls
`texttext search "pricing" --json` directly, then reads the exact returned item
id. It does not crawl every folder before answering. A JSON read also returns
the current content hash. Pass that hash as `--if-match-hash` on a prepared
write or section edit so TextText refuses stale work instead of overwriting a
person's newer edit.

## Verify the local connection

This is the harmless read the skills run before doing any work:

```sh
if command -v texttext >/dev/null 2>&1; then
  texttext ls
else
  /Applications/TextText.app/Contents/Helpers/texttext ls
fi
```

If neither command exists, install the standalone TextText build. If the read
reports that TextText is not signed in, open the app and sign in. Do not create a
token or start a server to repair a local setup.

## Included skills

- `texttext`: create, capture, find, read, and safely edit TextText documents
  through the signed-in local command. Publishing, sharing, comments,
  templates, and Trash require hosted MCP to be connected separately.
- `live-document`: use one open document as a shared canvas for human and agent
  edits.
- `capture-conversation`: turn a useful answer or discussion into a durable note.
- `project-changelog`: maintain one project record without duplicate entries.
- `publish-collaborate`: when hosted MCP is already connected, apply a
  validated look, publish safely, and manage collaborators.

## Remote and TestFlight clients

Hosted MCP is an explicit alternative for an external agent on another
computer, in a browser client, or in an automation. A TestFlight user can keep
the sandboxed TextText app open while a separately connected external client
uses hosted MCP. The TestFlight app itself is not an MCP client, and hosted MCP
is not bundled with the local Claude or Codex plugin.

Use `https://texttext.app/api/mcp` as the remote server and create a revocable
workspace token at `https://texttext.app/connect`. Save the token in the
client's protected credential field, not in the plugin, source code, or an
install command. TextText keeps authorization, content rules, and audit logging
below the client-specific integration layer.
