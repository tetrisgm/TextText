# Plan: the `texttext` CLI

> **ARCHIVED / DELIVERED (historical record).** Every unit of this plan shipped in
> Texttext `0.146`: the CLI, sections, automatic presence, audit intent, `new`,
> `open`, `lint`, `install`, the skills rewrite, the `PostToolUse` hook, and the
> retirement of the loopback MCP server. Kept for the reasoning behind the design.
> For the CURRENT reference see `docs/agent-interoperability.md`, which documents
> the surface as it actually shipped. Nothing below is current project status.

The CLI is not a file editor. It is **the agent's participation protocol for the
workspace**, and editing is one of its verbs. Because we ship both ends we define
the contract exactly: how an agent reads, how it writes, how it appears while it
works, and what the record says afterward.

Sync, conflict handling, and the `.textpack` format are already solved. This is
the interface over them.

Hosted MCP stays for browsers and phones, which have no shell. The local MCP
server retires.

---

## 1. Why the CLI can do what MCP could not

The CLI ships inside the app bundle and runs as the user, and the app already
keeps a device credential at `~/Library/Application Support/Write/credentials.json`
(mode 0600, a `wsk_` token plus origin, `Credentials.swift:7-12`). So the CLI is
authenticated by construction. There is no cookie problem, no port, no OAuth, no
pairing.

That single fact is what makes presence and attribution free rather than hard,
and it is where the earlier plan was wrong.

## 2. Commands

```
texttext ls [folder]                       list documents
texttext read <doc> [--section "## H"]     body, or one section, to stdout
texttext write <doc> [--from F]            replace body (stdin default)
texttext append <doc> [--from F]           append to body
texttext edit <doc> --section "## H"       replace one section
texttext new <title> [--folder F]          create, prints the path
texttext open <doc> [--section "## H"]     open in the app, scrolled there
texttext lint [PATH]                       validate
```

Global: `--as <name>` (who is working, defaults to a generic agent),
`--message "..."` (what this change is for), `--json`, stdin/stdout, nonzero exit
on failure.

`<doc>` is a workspace-relative path. Agents are good at paths and bad at uuids.

## 3. Presence is automatic, not a separate call

**Every mutating command publishes presence before it acts and clears it after.**
The agent never has to remember to announce itself, because the CLI already knows
what it is doing. This is the thing an agent could never get right through a tool
surface that required an explicit signal.

```
texttext edit posts/launch.md --section "## Pricing" \
  --as codex --message "tighten the pricing copy"
```

While that runs, the open document shows Codex with its provider color, anchored
at the Pricing heading, and the change lands with a stated intent.

**Section anchoring is better than what the local MCP server does today**, which
pins a cursor to the end of a whole field (body or title). A human has a caret; an
agent has a region of interest. Headings are the natural unit for that, they
survive edits above them, and they are what an agent already reasons in.

`--as` is self-declared, exactly as `clientInfo` was. That is acceptable under the
trust model already settled in `docs/decision-local-mcp-trust.md`: same-user
processes are trusted, and Tier 0 closed the case that mattered.

## 4. Intent closes the audit gap

`--message` rides through to `action_audit`, so a row records that Codex tightened
the pricing copy rather than that something changed. That is task #119, solved as
a side effect rather than as its own project, and it is only possible because the
CLI sees the operation and the reason together.

## 5. Correctness

**The CLI owns the `.textpack` invariants completely.** Unzip, edit, repack,
frontmatter preserved byte-for-byte, `info.json` intact, assets kept, outer
filename matching the inner bundle. An agent never touches the zip, so that class
of corruption stops existing. Reuse `TextBundlePackage.swift` rather than writing
a second implementation of the format.

**Writes are atomic.** Unpack to a temp dir, modify, repack to a temp file in the
same directory, fsync, `rename(2)` over the target. A crash leaves the old
document intact and the File Provider sees one complete replacement, never a
partial file.

**Section edits are surgical.** Parse headings, replace only the addressed span,
leave every other byte alone. This is what makes concurrent work safe in practice:
two agents in different sections of one document do not collide, and a human
typing elsewhere is untouched.

## 6. Build and install

- `.executableTarget(name: "TexttextCLI")` in `mac/Package.swift`, depending on
  `WriteFileProviderKit`.
- `mac/scripts/build-app.sh` copies the binary to `Contents/MacOS/texttext` and
  signs it with the app's identity and hardened runtime. One extra `codesign`
  call, no entitlements.
- The app offers to symlink it to `~/.local/bin/texttext` on first run. No admin
  prompt, unlike `/usr/local/bin`. The absolute bundle path always works as a
  fallback, and the skills name it.
- `texttext open` uses the existing `write-app://` scheme (`mac/Info.plist:66-69`),
  which already parses deep links and queues them across cold launches.

## 7. Skills

`plugins/texttext/skills/*/SKILL.md` currently instruct MCP tool calls. Rewrite
the local ones to the CLI, including `--as` and `--message` so attribution and
presence come for free. Same plugin, same install, different body.

One rule at the top of each skill serves both transports: if `texttext` is
available use it, otherwise use the MCP instructions for remote clients.

Add `AGENTS.md` at the workspace root for agents that arrive without the plugin.

## 8. Linter and hooks

`texttext lint` validates zip structure, `info.json`, `text.md`, frontmatter,
asset references, and filename-to-bundle match. Exit nonzero, one line per
problem.

A `PostToolUse` hook on `Bash|Write|Edit` runs it and returns `decision: block`
with the failure text, so an agent sees the error and fixes it.

Scope it honestly: **once the CLI owns writes, the linter catches agents that went
around the CLI.** Worth having as a net. Not worth building twice.

## 9. Retiring the local MCP server

`open_item` becomes `texttext open`. Presence becomes automatic (section 3), which
is strictly better than what the server does now. Nothing else it exposes survives
the CLI.

So it retires cleanly, and with it go the port, the transport guard, its health
checks, and the entire trust problem, which is deleted rather than mitigated.

## 10. Build order

1. **CLI core**: `ls`, `read`, `write`, `append`, atomic replace, format
   ownership, packaged and signed. Verified by round-tripping a real document and
   diffing bytes.
2. **Sections and presence**: `--section` parsing, surgical replace, automatic
   presence with `--as` and `--message`, audit intent. Verified by watching a
   heading-anchored avatar appear in the open app while a command runs.
3. **`new`, `open`, `lint`**, plus the install symlink.
4. **Skills rewrite and `AGENTS.md`.** Verified by asking Claude Code to append a
   changelog entry with no other instruction.
5. **Hook config.** Verified by deliberately breaking a pack and confirming the
   agent is blocked with a usable message.
6. **Retire the local MCP server**, updating the health check, the interop gate,
   `ConnectPanel`, and the docs.

Units 1 and 2 are the product. A working CLI that edits correctly and shows the
agent working is worth shipping even if nothing after it lands.
