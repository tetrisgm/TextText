# TextText handoff

## Current work

The owner requires ordinary folder workspaces, self-contained TextPacks, direct
agent file editing, and local/web conflict handling. Legacy migration is not a
prerequisite. See [architecture](design/texttext-file-vault-migration.md) and
[implementation and verification receipt](file-vault-implementation-2026-09-30.md).

Implemented on `main` in `76f373e1`, `f28500cd`, and `3b4549d6`: native folder
store/CLI, complete-pack filesystem server and durable sync, bundled shared
editor, file templates, and native assistant file tools. Local WIP **0.202 (1117)**
is installed at `/Applications/TextText.app`. Its selected workspace is
`/Users/shokunin/Documents/TextText`. Installed-app creation/save and a real
Codex append were verified against pack bytes and the refreshed editor. The
verification note was moved to recoverable vault Trash afterward.

## Blockers and next work

- The old localhost:3000 server has not been restarted. Permission was requested
  because the owner's contract requires approval for service restarts; no answer
  has arrived. Revalidate PID before switching. The replacement production build
  is ready in `.texttext/vault-build`; temporary preview3131 is stopped.
- Activate that build with `TEXTTEXT_VAULT_ROOT` and complete installed-account
  web connection acceptance after permission. Real native HTTP two-replica sync
  and browser pack editing already passed in isolated fixtures.
- Shared access/full live collaboration, browser assistant, full capture/import,
  publication, and retirement of legacy content callers remain integration work.
  Do not claim the entire earlier product plan is complete.
- Preserve unrelated dirty `attachments.ts`, `tabs.test.ts`, and
  `scripts/.probe-editor.ts`. All agents are finished. Use sequential heavy
  checks and two Swift jobs. No persistent jobs were installed.

## References

The receipt links current tests and limitations. Earlier product work and proofs
are archived in [September 30 history](HANDOFF-history-2026-09-30.md) and
[the previous checkpoint](TEXTTEXT_UX_CHECKPOINT.md); their installed versions
and process identities are historical. Public deployment/release/push was not
performed. The brief requires a separate ask for those actions. Local app
replacement is authorized. No release changelog entry is due for this local WIP.
