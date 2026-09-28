# TextText handoff

## Current work

The owner asked for the full [content-first brief](design/texttext-content-first-ux.md), including the shared shell, writing, visual collecting, reading, multiplayer, in-app agent work, performance, and recovery. Continue from the canonical [checkpoint](TEXTTEXT_UX_CHECKPOINT.md), reconciling it with `git status` before editing. [DESIGN.md](../DESIGN.md) now summarizes the governing presentation direction; [reference notes](design/content-first-reference-notes.md) and the [pre-redesign production baseline](content-first-baseline-2026-09-28.md) give concrete evidence. Keep one coding session, one necessary dev server, and sequential heavy checks.

Source is `main` in this checkout, four local commits ahead of `origin/main` at the start of this brief. Preserve the unrelated dirty files named in the checkpoint. The September 28 release gate stopped at `web.unit` with 13 failures in six files; `/tmp/texttext-wip-release-gates.log`. Do not push failed required checks. The current isolated production build for baseline passed but no new full release gate or attestation exists.

## Installed local WIP

The owner authorizes local Mac app replacement and installation going forward. `/Applications/TextText.app` is the development-signed Store-shaped **1.0 (1095)** bundle with signed Codex CLI 0.153.4 and local `http://localhost:3000` origin. It needs the local Next server and Postgres. The prior 1094 bundle is recoverable in Trash. The public website and release channels were not changed. Do not deploy, publish a release, submit to the App Store, or change billing without a separate owner request. No project changelog entry until a release is shipped.

The isolated Store-shaped app already proved clean-profile ChatGPT authorization, preserved selected-document Customize request, real preview/refinement, save/read-back/reopen, and native TextText tool read/write. See the [agent workflow receipt](agent-experience-verification-2026-09-25.md) and [sandbox receipt](agent-runtime-sandbox-verification-2026-09-25.md). The installed 1095 profile has not yet repeated that complete journey; do not treat a helper launch or stored login as equivalent proof. Distribution approval remains untested.

## Next action and references

Implement the first content-first shell/content slice against the existing TextPack and shared-command paths. Use the checkpoint for exact process identities, tests, changed files, pending measurements, and next command. Historical detail from the previous handoff is in [September 28 history](HANDOFF-history-2026-09-28.md). The [AI architecture](ai-sidebar-architecture.md), [agent runbook](agentic-assistant-runbook.md), and [database operations](DATABASE-OPERATIONS.md) remain authoritative for their respective boundaries.
