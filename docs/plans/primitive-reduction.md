# Reducing the render primitives

Status: plan, not started. Written 2026-08-28.

## Why

Item types are designed by the assistant, so the set of kinds a workspace holds
is open and growing. The render spec is the language those types are written
in, and a language that is going to be generated needs to be small: fewer
primitives, each parameterised, so the grammar is easy to hold and the output
space is not narrowed.

Today it is 22 node type names carrying 17 distinct property shapes, and the
renderer already collapses several of them by falling through between cases.
The names are the redundancy, not the behaviour.

## What is actually there, measured

Counted by walking `item` and `collection.item` of the 11 active built-in looks
and all 372 stored looks in the local database.

| Node | Built-ins | Stored | Notes |
| --- | ---: | ---: | --- |
| `text` | 46 | 1693 | |
| `stack` | 24 | 910 | |
| `badge` | 4 | 670 | |
| `facts` | 4 | 496 | |
| `prose` | 13 | 442 | |
| `cover` | 12 | 193 | |
| `metadata` | 2 | 186 | |
| `masthead` | 9 | 173 | |
| `group` | 0 | 169 | assistant-generated only |
| `toggle` | 0 | 152 | assistant-generated only |
| `byline` | 3 | 77 | |
| `checklist` | 3 | 31 | |
| `rows` | 3 | 20 | |
| `image` | 0 | 5 | |
| `divider` | 0 | 4 | |
| `progress` | 3 | 3 | |
| `video` | 2 | 0 | built-ins only |
| `gallery` | 1 | 0 | built-ins only |
| `callout` | 1 | 0 | built-ins only |
| **`spacer`** | **0** | **0** | never used |
| **`quote`** | **0** | **0** | never used |
| **`poll`** | **0** | **0** | never used |

An earlier version of this table was wrong, roughly threefold, and the
adversarial review caught it. The walker recursed into every object value AND
into `children`, so every node under a container was counted more than once.
Only `children` carries the tree. The zero-usage finding survived the
correction, because zero is zero either way.

Caveat: this counts the 11 ACTIVE built-ins. The 18 retired definitions still
resolvable in `templates.ts` were not walked, and one of them is
`texttext.poll`. Anything deleted rather than aliased must be checked against
those too, or a document pinned to a retired look stops rendering.

Four groups already share a property shape exactly, and the renderer already
falls through between them: `cover`/`image` fall into `video`, and `group`
falls into `masthead`.

| Names | Shared shape |
| --- | --- |
| `cover`, `image`, `video` | `bind, alt, fit, height` |
| `group`, `masthead` | `gap, children` |
| `byline`, `metadata` | `id, showWhen` only |
| `divider`, `spacer` | `size` |

Nine names, four behaviours.

## Target grammar

| Target | Absorbs | How the difference is carried |
| --- | --- | --- |
| `stack` | `stack`, `group`, `masthead` | `role: "plain" \| "masthead"`, plus existing `direction`, `align` |
| `media` | `cover`, `image`, `video`, `gallery` | `role: "cover" \| "inline"`, `columns` for the gallery case |
| `meta` | `byline`, `metadata` | `variant: "byline" \| "metadata"` |
| `space` | `divider`, `spacer` | `rule: boolean` |
| `field` | `badge`, `toggle`, `progress` | `variant: "badge" \| "toggle" \| "progress"` |
| `rows` | `rows`, `checklist`, `poll` | `variant`, plus the checklist and poll bindings |
| `text` | `text`, `quote` | `role` gains `quote`; `attributionBind` |
| `prose`, `facts`, `callout` | unchanged | |

22 names to 10.

### What each collapse costs

- **Free**: `stack`, `media`, `meta`, `space`. Same shape, same rendering, one
  name instead of two or three. Nothing about the output changes.
- **Cheap**: `text` absorbing `quote`. `quote` is unused in every look counted,
  so this is renaming an unused node into a role that will be used.
- **A real trade**: `field` and `rows`. Both widen a node's property set to
  narrow the vocabulary. `rows` absorbing `poll` means `closesBind` and
  `multiple` ride along on a node that is usually a plain table, and a reader of
  the schema can no longer tell from the type alone which properties apply.
  `field` absorbing `progress` is the weakest of the three: `progress` reads a
  computed `source`, not a `bind`, so the merged node has two mutually
  exclusive ways of naming its input.

If the trade is judged bad, stopping after the four free ones plus `quote`
still takes 22 to 16 and costs nothing.

## Sequence

Each step ends green: `npx tsc --noEmit`, `npm test`, `npm run lint`, and for
anything touching the renderer, `npm run evals` on a freshly restarted dev
server.

### 0. Delete what nothing uses

`spacer`, `quote` and `poll` are unused across the built-ins and all 372 stored
looks. Before deleting, walk the 18 retired definitions too. If they are also
clear, remove those three from the schema, the renderer and the compiler. This
is subtraction with no migration and no compatibility layer, and it makes every
later step smaller.

Verification: the render-spec doc test fails until the doc drops them, which is
the intended signal.

### 1. Accept both spellings at the parse boundary

Add the target node types to `renderNodeSchema` alongside the current ones, and
normalise on parse: a stored `masthead` becomes `{type: "stack", role:
"masthead"}` before anything downstream sees it.

**Normalise inside `templateDefinitionSchema`, not inside
`validateTemplateDefinition`.** An earlier draft of this plan claimed the
wrapper was the single choke point every spec passes through. It is not:
`src/lib/documents/sync.ts:40` embeds `templateDefinitionSchema.optional()`
directly in the sync envelope, so a look arriving inside a `.textpack` is
parsed by the raw schema and never sees the wrapper. That hole was introduced
on 2026-08-28 by the change that inlines a look into the envelope, and the
adversarial review found it. Putting the transform on the schema itself covers
both paths by construction, and any future embedder as well.

Nothing else changes yet. Old looks keep working, new looks can be written
either way, and the renderer can be reduced to the target cases immediately
because it never sees the old names again.

Verification: a test that feeds each old node type through
`validateTemplateDefinition` and asserts the normalised output, plus the
existing render tests unchanged.

### 2. Reduce the renderer

With normalisation in place, `DocumentRenderer` handles only the target types.
The fallthrough cases disappear rather than being rewritten.

Verification: `npm run evals`, specifically `eval:folder-look`,
`eval:save-as-look`, `eval:item-type` and the nine-brief look suite against the
committed baseline. Drift in that baseline is the signal to look at
screenshots, not to update it.

### 3. Emit only the target names

`item-type-blueprint.ts` builds nodes for every assistant-designed type, and
`templates.ts` hard-codes them for the 11 built-ins. Both switch to the target
vocabulary. Built-in template versions are NOT bumped: the rendered output is
identical, and bumping would repin every document.

Verification: a test asserting no built-in definition contains a legacy node
type, and the look suite again.

### 4. Migrate stored looks

`scripts/migrate-render-nodes-to-reduced-grammar.mjs`, in the release order,
rewriting `item` and `collection.item` in `document_templates.definition`.
Pure JSON transform, idempotent, reporting how many looks and nodes changed.

The transform is the same function used in step 1's parse normalisation, so
there is one implementation of the mapping and the migration cannot disagree
with the runtime.

Verification: run against a copy of the local database first, diff the render
tree of every stored look before and after, and assert equality. 372 looks is
small enough to check exhaustively rather than sample.

### 5. Drop the old names

Remove the legacy branches from the schema and the normaliser. Only safe once
production has been migrated, so this ships in a later deploy than step 4.

Verification: a query asserting zero stored definitions contain a legacy node
type, run before the deploy.

## Risks

| Risk | How it is caught |
| --- | --- |
| A stored look stops rendering | Step 4 diffs the render tree of all 372 looks before and after |
| A document pinned to a RETIRED built-in breaks | Step 0 walks the retired definitions; steps 1 to 3 keep them parsing through the normaliser |
| The look suite drifts and is accepted | Baseline drift does not fail the run, so it must be read deliberately. Do not `--update-baseline` in this work |
| Migration and runtime disagree | They share one mapping function by construction |
| A `tsc`-clean edit renders wrong | The look suite renders and measures real pages; unit tests alone are not sufficient for step 2 |
| Scripted edits corrupt a large file | Five separate scripted-surgery attempts failed in one session on 2026-08-28. Hand edits, or a TypeScript-aware tool |

## Rollback

Steps 0 and 1 are code-only: revert the commit.

**Steps 2 and 3 are not**, which an earlier draft got wrong. The moment the
compiler emits target names, every newly designed look is PERSISTED in the new
grammar, and sync hands those looks out inside `.textpack` files. So durable
data in the new format exists before step 4 runs, and a rollback of the app
meets looks it cannot parse. Either ship steps 1 and 2 (accept both, render
both) and let them soak before step 3, or accept that rollback past step 3
requires the down-migration too. Step 4 writes to stored looks
and needs a paired down-migration written at the same time as the up, mapping
target names back to the legacy ones. It is lossless in that direction because
the legacy vocabulary is strictly larger.

Step 5 is the point of no return, and only after production data is verified.

## Open questions for the owner

1. Are `field` and `rows` worth the widening? Stopping at the four free
   collapses plus `quote` gives 22 to 16 with no schema widening at all.
2. `progress` inside `field` names its input with `source`, not `bind`. Keep it
   separate, or accept two input shapes on one node?
3. `poll` is unused but a retired built-in is named `texttext.poll`. Delete the
   node, or keep it for a feature that may return?
