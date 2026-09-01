# Reducing the render primitives

Status: three merges done, the rest STOPPED after review. Was: Written 2026-08-28, then rewritten against an
adversarial review by Codex 5.6 Sol at xhigh reasoning, which found the node
counts wrong by threefold, the parse boundary claim false, step 0 fatal, and
step 5 permanently unsafe. Its verdict on the first draft was "not safe to
execute as written". What follows is the corrected version.

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

Revised after review. The first draft flattened each family into one wide
object, which lets the type system accept combinations that cannot render:
`badge` and `toggle` read `bind` (`schema.ts:480`, `:492`) while `progress`
requires `source` (`schema.ts:577`), so a flattened `field` permits both at
once. Where a family's members have mutually exclusive required properties,
the discriminator has to be nested, not a sibling flag.

| Target | Absorbs | Carried by |
| --- | --- | --- |
| `meta` | `byline`, `metadata` | `variant`. Same shape, distinction preserved. Free. |
| `space` | `divider`, `spacer` | `rule: boolean` plus `size`. Free. |
| `stack` | `group`, `masthead` | `role: "plain" \| "masthead"`. `.tt-masthead` centres and constrains to the measure while `.tt-stack`/`.tt-group` stretch (`styles.ts:15`), so the role has to survive into the class name. |
| `media` | `cover`, `image`, `video`, `gallery` | `kind: "image" \| "video" \| "gallery"` AND `role: "cover" \| "inline"`. One flag is not enough: the renderer branches on `type === "video"` (`DocumentRenderer.tsx:333`) and gallery carries `columns`. |
| `field` | `badge`, `toggle` only | A NESTED union: `{type:"field", spec: {kind:"badge", bind, appearance} \| {kind:"toggle", bind, labelBind?, appearance}}`. `progress` stays out: it reads `source`, not `bind`. |
| `rows` | `rows`, `checklist` only | Nested union on `variant`. `poll` stays out: it is an authorisation signal for reader responses, not a presentation variant, and `responses.ts` discovers polls by node type. |
| unchanged | `text`, `prose`, `facts`, `callout`, `quote`, `progress`, `poll` | |

22 names to 13, not 10. `quote` keeps its `block \| pull \| attributed`
variants (`schema.ts:597`), which a `role: "quote"` on `text` would have lost.

The four free merges alone take 22 to 18 and cost nothing. Everything past that
is a judgement about whether a smaller vocabulary is worth a nested union.

## Sequence

Each step ends green: `npx tsc --noEmit`, `npm test`, `npm run lint`, and for
anything touching the renderer, `npm run evals` on a freshly restarted dev
server.

### 0. Delete only `spacer`, and only after step 1

WAS: delete `spacer`, `quote` and `poll` first, because they are unused.
WRONG, and the adversarial review caught it against my own caveat.

`quote` is in the retired `bookshelf` look (`templates.ts:1022`) and `poll` is
in retired `texttext.poll` (`templates.ts:3477`) and `texttext.rsvp`
(`templates.ts:3579`). Those definitions are validated AT MODULE LOAD by
`legacyDefinitions.map(validateTemplateDefinition)` (`templates.ts:3653`), so
removing either from the schema throws on import and takes the whole module
with it, not one page pinned to one look.

`spacer` appears in no active or retired definition and no stored look. Even so
it moves AFTER step 1: a `.textpack` exported months ago is outside the
database and has no expiry, so it can still carry one. Delete the emitter and
the renderer branch; keep accepting the name on input.

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

A release-ordered migration would rewrite `item` and `collection.item` in
`document_templates.definition`. It would be a pure JSON transform,
idempotent, reporting how many looks and nodes changed.

The transform is the same function used in step 1's parse normalisation, so
there is one implementation of the mapping and the migration cannot disagree
with the runtime.

Verification: run against a copy of the local database first, diff the render
tree of every stored look before and after, and assert equality. 372 looks is
small enough to check exhaustively rather than sample.

### 5. Drop legacy EMISSION only, never legacy acceptance

WAS: remove the legacy branches from the schema. That is unsafe permanently,
not just until production is migrated.

A `.textpack` on disk carries `template.json` with a whole look inside, and the
Mac treats it as opaque JSON: it validates only that it parses
(`TextBundlePackage.swift:251`), reads it back from an edited package
(`FileProviderExtension.swift:1121`), and posts it unchanged into the sync
envelope (`LiveTextTextSyncAPI.swift:617`). The server then validates the whole
envelope through the embedded schema (`sync.ts:40`, used at `sync.ts:109`).

So after removing legacy names, a person editing a bundle exported before the
migration gets HTTP 400 from the PUT route, and the rejection happens BEFORE
the best-effort template install, so **their prose is not saved either**. A
zero-row database query cannot prove this safe: the bundles are outside the
database and never expire.

Legacy spellings stay accepted and normalised at every external parse boundary
indefinitely. What step 5 removes is legacy EMISSION and the legacy renderer
branches.

## Consumers the first draft missed

Found by review, each verified against source.

| Consumer | What breaks |
| --- | --- |
| `validateTreeBindings` (`schema.ts:855`) | Branches on old node names at 868 to 959. After normalisation it receives target names and silently stops validating bindings. Must change in step 1, not step 2. |
| Poll discovery (`responses.ts:10`, `:26`) | Finds polls by node type. A `rows` carrying a poll variant is never found and `/api/respond` 404s (`respond/route.ts:69`). This is why `poll` stays its own node. |
| `verify-template-render.ts:83` | Collects node types but its marker map (93 to 102) holds only legacy names, so target types are silently unchecked. It also loops only ACTIVE built-ins (105), so it would not have caught the retired-look breakage. |
| `render-spec-doc.test.ts:75` | Asserts more than 15 node types, so a final vocabulary of 13 fails it deliberately. A `.transform()` on `templateDefinitionSchema` also turns it into a pipe and breaks `.shape` introspection at 111 to 114. |
| Renderer class names (`DocumentRenderer.tsx:332`, `:1010`) | Classes derive from node type, and both the engine CSS and the look eval select on them (`eval-sidebar-looks.ts:378`). Semantic classes must be preserved explicitly, not derived from the new type. |
| `document-types.md:105` | Enumerates the old vocabulary and is not test-enforced, so it will drift silently. |

Checked and NOT affected: item-type quality reads blueprint field types, not
render nodes (`item-type-quality.ts:18`); the AI prompt emits the blueprint
grammar, not render nodes (`item-type-generation.ts:6`); HTML export delegates
to the renderer (`export.server.tsx:23`); no Swift branches on node type, which
is exactly why a stale `template.json` survives unchanged.

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

**Step 1 as built emits nothing new**, so it is genuinely code-only: revert the
commit and nothing on disk or in the database is in a vocabulary an older build
cannot read. That is why normalisation happens at the renderer rather than on
parse. An earlier attempt normalised on parse, which rewrites the object every
serializer downstream writes out; the review of the diff caught that where the
review of the plan had not.

**Steps 3 onward are not.** Once anything emits the target names, they reach
stored looks AND exported `.textpack` bundles. A database migration can rewrite
the former and can never reach the latter: a bundle sits on someone's disk with
no expiry, and the Mac hands its `template.json` back verbatim.

So the compatibility floor is permanent, not temporary. Legacy spellings must
be accepted for as long as any bundle might exist, which is forever. What a
later step removes is legacy EMISSION, never legacy acceptance.

- Rolling back to any step: safe, as long as legacy acceptance never shipped
  removed.
- There is no "down-migrate then roll back below step 1" path for exported
  bundles, and an earlier draft that offered one was wrong.

## Open questions for the owner

1. Are `field` and `rows` worth the widening? Stopping at the four free
   collapses plus `quote` gives 22 to 16 with no schema widening at all.
2. `progress` inside `field` names its input with `source`, not `bind`. Keep it
   separate, or accept two input shapes on one node?
3. `poll` is unused but a retired built-in is named `texttext.poll`. Delete the
   node, or keep it for a feature that may return?

## Verdict on the first draft, and what changed

The review's ranked findings, and what each did to the plan:

1. **Step 5 permanently rejects old textpacks.** Legacy bundles carry a whole
   look and never expire; rejection happens before the content is saved, so a
   person loses their edit. Step 5 now removes emission only.
2. **The database migration is unsafe against an unrestricted rollback.** The
   step 1 dual-reader is now named as the rollback floor.
3. **Step 0 cannot delete `quote` or `poll`.** They are in retired built-ins
   validated at module load. Only `spacer` goes, and after step 1.
4. **Several collapses are lossy.** `field` flattening allows `bind` and
   `source` together; `media` cannot distinguish image, video and gallery with
   one flag; `text` absorbing `quote` loses three variants. The grammar is now
   13 names with nested unions, not 10 flat ones.
5. **Six consumers were missed**, including binding validation and poll
   discovery, both of which fail silently rather than loudly.

Two things the review got right that I had already written down and then
contradicted: the caveat that retired definitions were not walked was in the
first draft, immediately above a step 0 that deleted nodes anyway.


## Stopped after three, and why (2026-08-29)

`meta`, `space` and `media` are done. The remaining three are not being built,
on Codex's recommendation and my own measurement, because the premise did not
survive contact.

**The schema grew, and always will.** 17 union members before, 20 now. Legacy
spellings must be accepted permanently, because an exported `.textpack` carries
a whole look and never expires. So "fewer primitives" is unreachable in the
accepted grammar; only the CANONICAL set the renderer uses shrinks, 22 to 18.

**The AI never sees this vocabulary.** It writes BLUEPRINTS
(`item-type-generation.ts`), which the compiler turns into render specs.
`render-spec.md` says so explicitly. So reducing render-node names does nothing
for the goal of an AI generating document kinds from a simple grammar.

**The two-layer design already exists.** `people` compiles to
`reference + semantic`, `recurrence` to `enum` with preset options. A small
primitive set with a richer authoring vocabulary on top is what was asked for,
and it is what is there.

The remaining three, judged individually:

- `stack` absorbing `group` and `masthead`: NOT behaviour-preserving as
  proposed. Top-level `.tt-stack` gets page padding, `.tt-group` is measure
  constrained, `.tt-masthead` centres (`styles.ts:12`, `:81`, `:15`), and only
  `stack` has direction and align. Preserving that needs three roles plus
  constraints, which moves the discriminator rather than removing it.
- `field` absorbing `badge` and `toggle`: adds a permanent accepted spelling
  and a nested union to disguise two concepts as one, and overloads "field",
  which already means the stored document schema.
- `rows` absorbing `checklist`: least unreasonable, but checklist carries
  required `doneBind`, `labelBind`, mode, rollup and ordering that plain rows
  does not, and the AI already writes the simpler abstraction.

The work redirected to the blueprint grammar, which is what the model actually
writes and is transient, so it can change without a migration.
