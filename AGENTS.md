<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes. APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Main-only workflow (binding)

- `main` is the only durable development branch and the only release source for
  this repository. Ordinary work happens directly in the main worktree.
- Temporary branches or worktrees may be used only for isolated subagents. The
  parent agent must review and integrate their useful changes into `main`, run
  final verification on `main`, and remove those temporary refs before calling
  the task complete.
- Never leave completed work only in a subagent branch. If work cannot be
  integrated safely, provide an explicit handoff with its branch, worktree,
  commit, files, tests, and blocker.
- Before a final response, verify `git status`, `git worktree list`, and branches
  not merged into `main`. Report the main commit, cleanliness, remaining
  temporary refs, and release state.
- Releases happen only from clean, verified `main`, after the owner says the
  version is ready or asks to ship. Use the one-command ship workflow and leave
  the remote source, public artifacts, update feed, and installed app on the
  same source version.

## Work-unit instrumentation (binding)

- Start each coherent body of work with `npm run work:start -- "short label"`.
  Run verification through `scripts/work-unit.ts run` or the package recipes so
  commands have closed stdin, a process-group timeout, an exact source
  fingerprint, and a durable timing receipt under `.write/`.
- Use `npm run work:summary` while working and `npm run work:finish` after the
  final verification to persist elapsed time, failures, cache sizes, the
  slowest gates, and receipt reuse. Use `npm run work:doctor` when local work feels slow; the
  dev command prunes only an oversized Next development cache and never removes
  the Swift incremental cache.
- A passing command may be reused only when its command and exact source state
  match. `npm run verify:release` is the sole full release gate. Shipping must
  consume that exact receipt instead of repeating tests or trusting an
  environment flag.

## Release reliability

- Close stdin and impose a process-group wall-clock cap on every long agent,
  build, test, and publish child. Stash abandoned worker WIP before waiting for
  a clean tree.
- Scope process guards to this repository's absolute path or explicit working
  directory. Never use a bare shared script or program name.
- Ship only fast deterministic gates. Keep race and heavy suites required out
  of band; use deterministic assertions plus generous hang guards.
- In launchd, load `GH_TOKEN` from a mode-600 env file, disable prompts, and
  pin absolute tool paths. Do not rely on Keychain UI or a login shell.
- Key retries to the stable source commit. Probe and bump to the next free
  immutable version; never reuse published identifiers.
- Keep ship and agent lanes mutually exclusive. The release driver is launchd
  `KeepAlive` and agent-free, with deterministic continuation rather than a
  model turn.

# AI approach (binding)

Full architecture: docs/ai-sidebar-architecture.md. The short contract every
agent working here follows:

- **Two explicit ways to connect AI.** (1) The in-app assistant uses a
  workspace-owned Anthropic or OpenAI API key and the model selected in
  Workspace Settings. Texttext never silently spends an owner-funded shared
  key. Provider API billing is separate from ChatGPT and Claude.ai
  subscriptions. (2) Existing ChatGPT, Claude, Cursor, and other agent
  subscriptions connect externally through MCP (`/api/mcp`,
  click-to-approve OAuth) and keep their model and billing in that client.
  The legacy Apple Foundation Models bridge is not an active product provider
  and must not be restored as an automatic fallback.
- **One command surface, three consumers.** The UI, the in-app assistant,
  and the MCP server call the same workspace commands. The app never
  consumes its own MCP server over the network.
- **Release gates.** `python3 scripts/test-oauth-mcp-loop.py` must pass for
  any change touching OAuth, the well-known documents, or the MCP handler.
  Never use `Response.redirect()` in the OAuth approve route (immutable
  headers 500 the approval).
- **Privacy invariants live below the tool layer**: notes and bookmarks stay
  unlisted forever, every mutation writes `action_audit`, and
  `src/lib/store.ts` remains the only content access point, no matter which
  AI is calling.
- **Reusable versions** of this surface live in `~/dev/stack` (`mcp-kit`,
  `mac-kit/templates/native-ai`). Improvements flow product to kit; port
  hardening back and note it in the kit README.

# Changelog (binding)

The owner reads a running changelog INSIDE Texttext. It is NOT a repo file: the
changelog is the "Texttext Changelog" note in their workspace (Shoku's Space / My
Notes), and that note IS the single source of truth. It is content, so it lives
in the product, in the product's own format (a `.textpack`, whose inner
`text.md` is markdown). Do not add a parallel `.md` copy in the repo; that
drifts and violates the "content is a note" rule.

Every unit of meaningful, user-facing work prepends a newest-on-top entry to
that note. Group by shipped version; plain language you can act on ("type # in
the tag field to..."), sentence case, no em dashes, no engineering detail.
Internal-only churn (refactors, test/infra fixes, release-pipeline tweaks) does
not need an entry.

Only a process on the owner's Mac can write the File Provider mount, so the
owner or the integrator updates the note (Codex in a sandbox cannot reach it and
should instead put its user-facing entry in its final report for the integrator
to prepend). To edit by hand: unzip
`~/Library/CloudStorage/Texttext-Texttext/Shoku's Space/My Notes/Texttext Changelog.textpack`,
edit the inner `text.md` body (preserve the frontmatter block byte-for-byte),
rezip preserving the `.textbundle` structure, and copy it back over the same
filename (a content edit, not a rename, so it syncs cleanly).
