# Multiple file edits during draft recovery

The retained `full1235` Windows draft contains all six PC input markers.
The original app/profile, current TextPack and sync state were preserved at
`C:\Users\Shokunin\dev\full1235-preserved-before-restart` before stopping the
stuck diagnostic app. The backup has not been cleared or used in place.

## Reproduced cause

Restoring the draft before cloud reconciliation merged successfully. Reconciling
cloud changes first, then restoring the same draft, produced `/content/body`
conflict. The previous merge represented all edits on one side as a single
replacement; separate additions before and after the base looked overlapping.

## Repair

The existing linear merge remains the fast path. Remote-first callers now use
pinned jsdiff 9.0.0 for a bounded fallback (20,000 UTF-16 units per affected span,
2,000 edit distance per side). Independent ranges merge, identical edits dedupe,
and overlapping replacements still preserve both snapshots without overwriting.
The Yjs adapter maps only authored external ranges through local changes and
verifies the complete projection before applying them, in descending order.
It does not replace the document or regenerate the merged body as a new string.

## Evidence and limits

- A new live-client regression failed before the fix and passes afterward:
  external prepend plus append alongside pending human typing, stable Y.Doc,
  caret, human undo/redo, and server flush.
- 83 focused reconciliation/client tests passed.
- TypeScript passed.
- The actual preserved startup-order fixture now merges with all six PC markers
  present exactly once and an applicable external edit projection.
- Logs: `/tmp/texttext-multispan-{baseline,combined,tsc}.log`.
- Physical restart and six simultaneous clients remain unverified for this fix.
  PC SSH temporarily resets after handshake on both existing routes. No network
  configuration or credentials were changed.
- Dependency audit lists five high findings in the existing ESLint/fast-glob/
  micromatch/braces development chain, none in the newly added diff package.
  No automated downgrade or forced audit fix was applied.
