# Collab hole 2: safe between-sessions reseed (reset-generation design)

Status: DESIGN ONLY (not built). Written 2026-07-15 so the cost of closing the
last co-editing durability hole is legible before committing to it. Holes 1 and
3 shipped in v0.77/v0.78; this covers hole 2. See the memory note
`collab-durability-holes` for the full hole list.

## The hole

The Yjs co-editing log (`collab_updates`) and the canonical `posts.body` are two
representations bridged only on the client (TipTap serializes the shared Y.Doc to
markdown on autosave; there is no `posts.body -> Y.Doc` path server-side).

Failure: a post is co-edited (log has content, consistent with `posts.body`).
The session ends. Someone then writes `posts.body` out of band through a
different surface (a Finder/sync PUT, an MCP `update_item`, or the owner's
pool-shell save). On the next co-editing open, the client replays the still-stale
log into the Y.Doc and its autosave writes that reconstruction back, overwriting
the newer external write. Permanent silent loss of the external write.

The live-session guard (v0.77) does not cover this: it only blocks external
writes while editors are actively present. Between sessions there are no active
editors, so the external write is (correctly) allowed; the damage happens later,
on reopen.

## Why the obvious fixes are wrong (already established)

- **Delete the stale log on external write** (tried in v0.77, reverted): an
  unbounded delete drops a co-editor's not-yet-materialized final edits, and
  races an in-flight push to orphan a delta (no snapshot preserved, unlike
  `maybeCompactCollab`). An adversarial review confirmed both as regressions.
- **CAS the collaborator autosave against a base revision carried in the Y.Doc**:
  regresses NORMAL two-person co-editing. The shared `baseRevision` propagates
  with Yjs lag, so a second co-editor autosaving during the lag conflicts
  spuriously. Unacceptable churn on the happy path.
- **Server-authoritative reseed (server builds the Y.Doc snapshot from
  `posts.body`)**: the clean answer in theory, but it needs markdown -> ProseMirror
  -> Y.XmlFragment in Node using the exact TipTap schema, with no DOM. Any schema
  drift silently corrupts documents. Too risky for the payoff.

## The design: reset by generation (epoch), never by deletion

Treat the log as a sequence of generations. When `posts.body` is written out of
band, the current generation is retired (not deleted) and a fresh one begins,
seeded from the authoritative `posts.body`. Stale rows are ignored by generation,
so nothing is deleted and no push is ever orphaned.

### State (schema)

- `posts.collab_epoch` INT NOT NULL DEFAULT 0 — the current log generation.
- `posts.collab_body_epoch` INT NULL DEFAULT NULL — the epoch whose
  materialization produced the current `posts.body`; NULL when the body was last
  written by a non-collab (external) path.
- `collab_updates.epoch` INT NOT NULL DEFAULT 0 — the generation each row belongs
  to.

Migration backfills all existing rows to epoch 0 and sets `collab_body_epoch`
NULL (any existing log is treated as "unknown provenance", so the first reopen
reseeds once, which is safe). Re-run note goes in the migrate script, same
pattern as `scripts/migrate-add-revision.mjs`.

### Write paths set provenance

- **Collab materialization** (the Yjs-shell autosave via `savePostContentPatch`,
  AND `POST /api/collab/{id}/materialize`): set `collab_body_epoch = collab_epoch`
  in the same write. The body now provably came from the current log.
- **External writes** (owner pool save `saveEditablePostAction` canEdit branch;
  `savePostAction`; sync PUT; MCP `update_item`/`append_to_item`): set
  `collab_body_epoch = NULL`. The body did not come from any log.

These are the same ~6 body-write sites the v0.77 guard already touches.

### The single decision point: the catch-up GET

`GET /api/collab/{id}` (the initial `since=0&wait=0` catch-up) is the ONLY place
that retires a generation, which makes it single-writer:

1. Read `posts.collab_epoch` (E) and `collab_body_epoch` (B).
2. If `B === E`: the current log produced the current body, so the log is
   consistent. Serve updates `WHERE epoch = E` as today.
3. Else (external write since the log last materialized): retire the generation
   with a compare-and-swap:
   `UPDATE posts SET collab_epoch = E + 1 WHERE id = ? AND collab_epoch = E`.
   Return an empty update list (remoteEmpty). The client seeds the Y.Doc from
   `posts.body` (the existing empty-log seed path in `BodyEditor`). The first
   collaborator autosave then sets `collab_body_epoch = E + 1`.

Concurrent opens are safe: only one GET wins the CAS and bumps; the other reads
the already-bumped epoch and takes the consistent path (or reseeds against the
new epoch). No lock needed.

### Append and compaction become epoch-scoped

- `POST /api/collab/{id}` tags each appended row with the current
  `posts.collab_epoch`.
- `collabUpdatesSince` / the relay filter `WHERE epoch = <current>`.
- `maybeCompactCollab` merges and self-limits within the current epoch only.

A push that lands in a just-retired epoch (client was a beat behind the bump) is
simply ignored by the new-epoch relay; that client reseeds on its next catch-up.
Its row is a complete, valid update in an old generation, never an orphan.

## What this closes, and the residual edges (be honest)

- **Closes hole 2**: an external write is never overwritten. On reopen the client
  reseeds from the authoritative `posts.body` instead of replaying a stale log.
- **No new corruption**: nothing is deleted, so the finding-2 orphaned-delta race
  cannot occur. The epoch bump is a single-writer CAS.
- **Sliver edge (shrunk, not gone)**: on reseed, the retired epoch's log is
  ignored, so any edits it held that never reached `posts.body` are dropped. The
  v0.78 pagehide materialization already pushes the final body to `posts.body` at
  session end, so this only bites if that materialization ALSO missed (over the
  60KB beacon cap, or CAS-skipped). Rare compound case; document it.
- **Double-seed edge (pre-existing)**: two clients reseeding the same
  `posts.body` simultaneously both push a seed, and Yjs merges them into
  duplicated content. This already exists today for two simultaneous first
  editors of a non-empty post; the reset path extends it to the stale-reopen
  case. A proper fix is seed election (a server-granted "you seed" token), which
  is out of scope for this doc and could be a follow-up.
- **Storage**: retired-epoch rows are kept. Add a lazy sweep that deletes rows of
  epochs below current for posts with no active presence (safe: no one reads old
  epochs). Low priority.

## Cost

- Schema: 3 columns + a backfill migration (run once on prod, like the revision
  migration).
- Code: epoch-thread append/GET/compaction; set `collab_body_epoch` at the ~6
  body-write sites; client reseed on the empty-new-epoch response (mostly reuses
  the existing seed path).
- Tests: epoch retirement on external write, consistent-path replay, concurrent
  CAS single-bump, append-into-retired-epoch ignored, provenance set/cleared by
  each write path. Plus an adversarial review before shipping (both prior collab
  changes this session shipped a clobber that only review caught).
- Estimate: 1 to 2 focused days including review.

## Recommendation

For a mostly-solo, pre-beta product this is a real investment against a rare
edge. Reasonable to defer until co-editing usage grows, keeping this doc as the
ready-to-build plan. Revisit when multi-editor workspaces are common.
