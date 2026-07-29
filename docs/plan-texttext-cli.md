# Plan: the `texttext` CLI

Local AI agents edit documents through a CLI over the synced files. No MCP, no
port, no token. Hosted MCP stays for browsers and phones, which have no shell.

Sync, conflict handling, and the `.textpack` format are already solved. This adds
one interface over them.

---

## 1. The CLI

Ships as `texttext` inside the app bundle. Reads stdin, writes stdout, exits
nonzero on failure. `--json` on any command for machine-readable output.

```
texttext ls [folder]                 list documents, one path per line
texttext read <doc>                  body markdown to stdout
texttext write <doc> [--from FILE]   replace body (stdin if no --from)
texttext append <doc> [--from FILE]  append to body
texttext new <title> [--folder F]    create, prints the new doc path
texttext open <doc>                  open it in the app
texttext lint [PATH]                 validate one or all .textpacks
```

That is the whole surface for v1. Everything else (publish, share, templates,
comments, trash) stays in the app or hosted MCP, because the app owns
presentation and access.

`<doc>` is a path relative to the workspace root, tab-completable and the thing
agents are best at. Accept a full path too. No uuids in the UX.

**The CLI owns the `.textpack` invariants completely.** Unzip, edit, repack,
frontmatter preserved byte-for-byte, `info.json` intact, assets kept, outer
filename matching the inner bundle. An agent never touches the zip, so the whole
class of corruption stops existing.

**Writes are atomic.** Unpack to a temp dir, modify, repack to a temp file in the
same directory, `fsync`, then `rename(2)` over the target. Never edit in place.
A crash mid-write leaves the old document intact, and the File Provider sees one
complete replacement rather than a partial file.

Reuse `WriteFileProviderKit` (`TextBundlePackage.swift`) for pack/unpack and
validation. That code already writes and validates this format; the CLI is a thin
argument parser over it, not a second implementation.

## 2. Build and install

- New `.executableTarget(name: "TexttextCLI")` in `mac/Package.swift`, depending
  on `WriteFileProviderKit`.
- `mac/scripts/build-app.sh` copies the binary to
  `Contents/MacOS/texttext` and signs it with the same identity and hardened
  runtime as the main binary. One extra `codesign` call; no entitlements needed.
- On first run the app offers to symlink it into `~/.local/bin/texttext`. No
  admin prompt, unlike `/usr/local/bin`. If the symlink is absent, the absolute
  path inside the bundle always works, and the skills use that as the fallback.
- `texttext open` shells out to the existing `write-app://` URL scheme
  (`mac/Info.plist:66-69`), which already parses deep links and queues them
  across cold launches.

## 3. Skills

`plugins/texttext/skills/*/SKILL.md` currently instruct MCP tool calls
(`list_folders`, `append_to_item`, `idempotency_key`). Rewrite the local ones to
use the CLI. Same plugin, same install, different body.

One skill can serve both transports: if `texttext` is on PATH or in the bundle,
use it; otherwise fall back to the MCP instructions for remote clients. State
that rule once at the top of each skill rather than forking the files.

Add an `AGENTS.md` at the workspace root so agents that arrive without the plugin
still learn the conventions: documents are `.textpack`, use `texttext` rather
than editing the zip, the app owns rendering and layout.

## 4. Linter and hooks

`texttext lint` validates: zip structure, `info.json` (version 2, type
`net.daringfireball.markdown`), `text.md` present, frontmatter parses and keeps
required keys, asset references resolve, outer filename matches inner bundle.
Exit nonzero with a one-line reason per problem.

Install a `PostToolUse` hook on `Bash|Write|Edit` that runs `texttext lint` over
the workspace and returns `decision: block` with the failure text when it fails,
so the agent sees the error and fixes it rather than logging into the void.

Note the honest scope: **once the CLI owns writes, the linter mostly catches
agents that went around it.** That is worth having as a net, and it is why the
linter is a small command rather than its own subsystem. Do not build it twice.

## 5. Local MCP server

Retire it once the CLI covers its job. Two capabilities need handling first:

- `open_item` becomes `texttext open`, via the URL scheme. Straightforward.
- Agent presence (the collaborator avatar) needs a path from a CLI with no
  session cookie into the app. Solvable through the URL scheme or a local signal
  to the running app, but it is real work, so it gates removal.

Until presence ports, leave the server as shipped. It is hardened (0.143) and
costs nothing to keep. When it goes, the entire trust problem goes with it rather
than being mitigated, along with the port, the guard, and its health checks.

## 6. Build order

1. **CLI core**: `read`, `write`, `append`, `ls`, atomic replace, packaged and
   signed in the bundle. Verified by round-tripping a real document and diffing
   the bytes.
2. **`new`, `open`, `lint`.** Verified against the app: create, open, confirm it
   appears.
3. **Skills rewrite plus `AGENTS.md` plus the install symlink.** Verified by
   asking Claude Code to append a changelog entry with no other instruction.
4. **Hook config.** Verified by breaking a pack deliberately and confirming the
   agent is blocked with a usable message.
5. **Presence port, then retire the local MCP server**, updating the health
   check, the interop gate, and `ConnectPanel`.

Units 1 and 2 are independently useful, since a working CLI is worth having even
if nothing else lands.
