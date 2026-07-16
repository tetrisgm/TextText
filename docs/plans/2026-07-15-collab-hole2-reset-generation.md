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

## Implementation wrinkle found 2026-07-16 (revision is trigger-assigned)

`posts.revision` is bumped by a `BEFORE UPDATE` trigger (`bump_revision()` sets
`NEW.revision := nextval('write_change_seq')`), so the new revision does not
exist at SET time. That means the "record the revision the log materialized from"
variant cannot set `collab_materialized_revision = <new revision>` atomically in
the same UPDATE. Two viable atomic options: (a) extend `bump_revision()` to also
set `collab_materialized_revision := NEW.revision` when a per-transaction flag is
present (`SET LOCAL write.collab_materialized = 'on'`, read via
`current_setting(..., true)`) - atomic but touches the shared trigger that fires
on every update; or (b) use the `collab_body_epoch` provenance variant instead
(set to the epoch on collab materialize, NULL on external body change), which
needs a body-change check in `savePost` but avoids the revision entirely. Prefer
(b): it keeps the shared revision trigger untouched. This is why the build is a
supervised effort, not a fire-and-forget migration: it modifies a hot write path
and ships an irreversible schema change for a rare edge.

## REFINED design 2026-07-16 (chosen for the build): collab_state, no hot-path change

To avoid touching `savePost` (the hot path) and the shared revision trigger,
track provenance in a SEPARATE table rather than on `posts`:

- `collab_state` { post_id uuid PK -> posts, epoch int NOT NULL DEFAULT 0,
  materialized_revision bigint NULL, updated_at timestamptz }.
- `collab_updates.epoch` int NOT NULL DEFAULT 0.

Staleness detection uses `posts.revision` (already bumped on every write by the
trigger) compared to a value the COLLAB layer records at materialization time -
so no `savePost` change and no revision-trigger surgery:

- Collab materialization (the Yjs-shell autosave `saveEditablePostAction`
  `!canEdit` branch, and `POST /api/collab/{id}/materialize`): after
  `savePostContentPatch` returns `saved.revision`, upsert
  `collab_state.materialized_revision = saved.revision` for the current epoch.
- External writes (owner save, sync PUT, MCP) do NOT touch `collab_state`, so
  after any external write `posts.revision > collab_state.materialized_revision`.

The catch-up GET is the single decision point AND is guarded so it can never
retire a LIVE session's log:

- On catch-up: if `!hasActiveCoEditors(postId)` AND (`materialized_revision` is
  null OR `posts.revision !== materialized_revision`) -> stale -> CAS
  `UPDATE collab_state SET epoch = epoch + 1 WHERE post_id = ? AND epoch = <read>`
  and return an empty update list (client reseeds from `posts.body` via the
  existing remoteEmpty seed path). Else -> serve `collab_updates WHERE epoch =
  <current>`.
- The `!hasActiveCoEditors` guard is the safety valve: a live session (fresh
  presence) is never retired, so the benign non-atomicity of "write body then
  write collab_state" cannot orphan a live log - during a materialize the
  session is active, so no bump happens. It also matches the v0.77 invariant
  (only act when no live session owns the doc).

Append / relay / compaction become epoch-scoped (`WHERE epoch = <current>`); a
push that lands in a just-retired epoch is ignored by the new-epoch relay and the
client reseeds on its next catch-up (a full, valid old-generation row, never an
orphan). No deletion, so no orphaned-delta race. Residual edges unchanged
(pre-existing double-seed on simultaneous reseed; storage of retired epochs needs
a lazy sweep). This variant is what the build implements.

## REVIEW FINDINGS 2026-07-16: the refined design is FLAWED as written (do not build it yet)

A 3-lens adversarial review of the collab_state design above found it unsafe. Do
NOT implement it as written. The required corrections make it a materially larger,
supervised build (a real client-provider change), not a fire-and-forget migration.

- FATAL - retire CAS is a silent no-op on the backfill population. Existing posts
  have no `collab_state` row, so `UPDATE collab_state SET epoch = epoch + 1 WHERE
  post_id = ? AND epoch = <read>` matches zero rows: the epoch never advances, and
  the reseed merges with the un-retired stale log, corrupting exactly the case
  hole 2 must protect. FIX: the retire step must UPSERT (INSERT epoch = 1 when no
  row, CAS-bump when present) with defined single-winner semantics for two
  concurrent opens.
- HIGH - the design is internally contradictory: "append tags each row with the
  current epoch" defeats "a push in a retired epoch is ignored." After a bump, a
  presence-lapsed-but-still-editing client (network blip > 15s; outbox retains
  edits, retries to 30s) flushes its retained edits, which get tagged with the NEW
  epoch, merge into the reseed-from-external-body doc, and overwrite the external
  write - the exact regression. Also: a still-connected provider is epoch-unaware
  and never re-runs catchUp, and BodyEditor's remoteEmpty seed only fires on an
  empty fragment, so such a client can never cleanly reseed anyway. FIX:
  epoch-FENCE the append on the client's asserted base epoch - the client sends
  the epoch it caught up under; POST inserts only if it still equals
  `collab_state.epoch`; on mismatch reject with a "retired" signal that makes the
  client drop its outbox and re-catch-up. This requires threading an epoch through
  the client provider (catchUp records it; poll/push carry it; a retirement
  response tears the loop down) - materially more than "reuse the seed path."
- HIGH - `!hasActiveCoEditors` (presence) is decoupled from edit-liveness. Presence
  heartbeats are a best-effort 8s loop that stops silently on any hiccup, while the
  outbox independently holds un-relayed edits. So a client can be genuinely
  mid-edit with expired presence, and a catch-up GET will retire the epoch out from
  under it. FIX: gate retirement on log QUIESCENCE (no new `collab_updates` rows
  for a window strictly longer than the max outbox retention / reconnect window,
  >= 30s) or a server-side lease a pushing client keeps alive, not presence.
- HIGH - the reseed never sets `materialized_revision`, so `posts.revision`
  permanently outruns it and the doc reseeds on essentially every open, discarding
  the live log routinely (turns the rare sliver loss into a routine one). FIX: the
  retire CAS must also set `materialized_revision` to the `posts.revision` it read.
- MEDIUM - non-atomic "write body then write collab_state" opens a false-stale
  window; the bump must be strictly gated to the `since = 0` catch-up (the poll
  GET shares the endpoint and would self-retire a momentarily-stale live editor);
  and the materialize's collab_state epoch predicate is unspecified (risks a double
  reseed or mislabeling a bumped epoch).
- MEDIUM - the NULL `materialized_revision` backfill forces a reseed on the first
  reopen of every pre-existing co-edited post, losing any pre-feature log tail that
  leads `posts.body`. FIX: a one-time controlled materialization of each existing
  log into `posts.body` before enabling, or do not treat NULL as unconditionally
  stale for a non-empty consistent log.

Bottom line: closing hole 2 correctly needs epoch-fenced appends (client-provider
change), quiescence/lease-based retirement, an upsert-and-set-materialized_revision
retire, `since = 0` gating, and a backfill materialization - then a re-review
before the prod migration. That is a supervised multi-day effort; it must not ship
unattended. The schema (collab_updates.epoch + collab_state) and the migration
were reverted after this review; rebuild them with the corrections when the build
is done supervised.

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
