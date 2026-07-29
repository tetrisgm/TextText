# Texttext continuation pointer

The canonical continuation state is `docs/codex/HANDOFF.md`.

The unified document engine rebuild is the current product architecture. Do not
restore the deleted bespoke Reader, ProjectReader, TalkReader, body editor, or
editor preview implementations. Read `docs/document-types.md` for the
implemented contract and `docs/review-2026-07-22.md` for its release audit.

Agents on this Mac use the `texttext` CLI; agents elsewhere use hosted MCP at
`/api/mcp`. The loopback MCP server was retired in `0.146` and must not come
back. `docs/agent-interoperability.md` is the reference.

Always inspect live `main`, worktrees, and release metadata before acting. The
newest user request supersedes historical task briefs. Anything under
`docs/archive/` is a historical record, not current status.
