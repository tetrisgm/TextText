# TextText.app handoff

## Current position

Cleaned remaining Git-tracked path casing so the download route and Swift CLI target folders are recorded as TextText in the repository index.

Workshop checkpoint `1785545368932-3d7cca9f` (product) — historical; the
Workshop machinery was removed fleet-wide on 2026-08-05.

## Next concrete step

Verify the case-only path cleanup by landing it through `merge-gate` from a
worktree branch (`stack/runbooks/workflow.md`).

## Blockers

None recorded.

## Ruled out

- Broad lower-case write replacement: remaining lower-case write hits are verbs, permission/API terms, or platform constants rather than product references.
- Leaving filesystem-only case changes: Git still tracked the prior casing on the case-insensitive macOS checkout.
