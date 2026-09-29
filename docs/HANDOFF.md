# TextText handoff

## Current work

The owner asked for the full [content-first brief](design/texttext-content-first-ux.md), including the shared shell, writing, visual collecting, reading, multiplayer, in-app agent work, performance, and recovery. Continue from the canonical [checkpoint](TEXTTEXT_UX_CHECKPOINT.md), reconciling it with `git status` before editing. [DESIGN.md](../DESIGN.md) now summarizes the governing presentation direction; [reference notes](design/content-first-reference-notes.md) and the [pre-redesign production baseline](content-first-baseline-2026-09-28.md) give concrete evidence. Keep one coding session, one necessary dev server, and sequential heavy checks.

Source is `main` in this checkout. The gallery, folder image capture, saved-link, article annotation, shared-work, Add agent entry, web test repair, and corrected benchmark slices are committed locally. The checkpoint has their commit IDs and proof. Preserve the unrelated dirty files named there. The retired release gate once stopped at `web.unit` with 13 failures; a later direct web unit run passed 3,721 tests with 134 configured skips (`/tmp/texttext-ux-web-unit.log`). Do not revive the retired gate scripts. The attached brief requires separate authorization before push or release.

## Installed local WIP

The owner authorizes local Mac app replacement and installation going forward. `/Applications/TextText.app` is the development-signed Store-shaped **1.0 (1097)** bundle with signed Codex CLI 0.153.4 and local `http://localhost:3000` origin. It needs the local Next server and Postgres. Prior 1096, 1095, and 1094 bundles are recoverable in Trash. The public website and release channels were not changed. Do not deploy, publish a release, submit to the App Store, or change billing without a separate owner request. No project changelog entry until a release is shipped.

The isolated Store-shaped app already proved clean-profile ChatGPT authorization, preserved selected-document Customize request, real preview/refinement, save/read-back/reopen, and native TextText tool read/write. See the [agent workflow receipt](agent-experience-verification-2026-09-25.md) and [sandbox receipt](agent-runtime-sandbox-verification-2026-09-25.md). [Browser auth verification](browser-auth-sandbox-2026-09-28.md) records the new callback permission, sandbox probe, and installed 1097 UI reaching Safari's normal ChatGPT consent page without a device code. The owner has not yet completed this installed-profile authorization or repeated the full authenticated journey. Distribution approval remains untested.

## Next action and references

After the owner completes Safari consent, verify installed-app ready status and one real item-scoped agent action. Continue with agent scope/reconnect, cold open, typing/collaboration, and recovery. Use the checkpoint and [performance receipt](content-first-shell-2026-09-28.md) for exact tests and pending measurements. Historical detail from the previous handoff is in [September 28 history](HANDOFF-history-2026-09-28.md). The [AI architecture](ai-sidebar-architecture.md), [agent runbook](agentic-assistant-runbook.md), and [database operations](DATABASE-OPERATIONS.md) remain authoritative for their respective boundaries.
