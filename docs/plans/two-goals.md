# The two goals, and what stands between us and them

Written 2026-08-29 against the owner's statement of what TextText is for.

**Goal one.** A person describes the kind of thing they want to keep - a certain
kind of blog, a certain kind of note, a bookmark, anything made of text - and
the assistant builds it: what content it holds, and how it looks. Afterwards
they can keep changing the look by asking.

**Goal two.** The assistant can read, update and delete anything. Change what is
in a note, summarise it, write a whole one, highlight the important parts, act
on one item or on many.

Both under three constraints: it stays simple, people can collaborate with each
other, and people can collaborate with agents.

Everything below was measured on `main` at `fb333959`, not remembered. Each
finding names the command that produced it so a reviewer can re-run it.

## What is already true

Worth stating plainly, because the list of problems is longer than the list of
things that work and that is misleading.

- 35 workspace commands are one registry (`src/lib/ai/tools.ts`), shared by the
  UI, the in-app assistant and the MCP server. Create, read, update, append,
  delete, restore, move, status, comment, share, search, folder and look
  operations are all there.
- An external agent over `/api/mcp` gets all 35. Codex on this Mac, through the
  `texttext` CLI, gets all 35.
- `npm run eval:item-verbs` drives a real model in plain English and asserts the
  workspace afterwards, not the model's summary. 21 checks, passing.
- Collaboration is built: Yjs with awareness, presence routes for humans and for
  agents, `signalAgentActivity` so an agent's avatar arrives with its edit.
- The item-type studio designs a type with a real model and previews it before
  saving.

## Finding 1: a look cannot be changed after it is saved

This is the largest gap against goal one, and it is a whole missing capability
rather than a quality problem.

The assistant authors a **blueprint**. The blueprint compiles into a
`TemplateDefinition`. Only the definition is stored: `document_templates` has
columns for `definition`, `name`, `version` and no column for the blueprint
(`src/lib/db/schema.ts:781`). The blueprint is discarded at save.

So afterwards:

- The studio has no way to open an existing type. Its props are `blogId`,
  `folders`, `initialFolderPath`, `onCreated` and no template to edit
  (`ItemTypeStudio.tsx:1`). It only ever opens blank.
- No agent tool updates one. There is `create_item_type`, `retire_document_template`
  and `list_document_templates`, and no update. `create_item_type` takes a
  blueprint and an optional folder path, with no way to name an existing type
  (`src/lib/ai/tools.ts:614`).
- `list_document_templates` hands back the compiled definition, which is not the
  language the model writes in.

"Make the date bigger on my recipe type" therefore has no path. The assistant
must invent a whole new blueprint from scratch, blind to the one that produced
what the person is looking at, and save it as a separate type.

**Fix.** Store the blueprint next to the definition, and let it be read back and
recompiled.

1. Add a nullable `blueprint` jsonb column to `document_templates`. Nullable
   because every existing row predates it, and built-ins have none.
2. Write it on create. Nothing reads it yet.
3. `list_document_templates` returns the blueprint when there is one.
4. New command `update_item_type`: takes a template id and a full blueprint,
   writes a new version. Versions stay immutable and documents keep pinning
   exact ones, so this adds a version rather than mutating one.
5. The studio opens on an existing type when it has a blueprint, and says
   plainly when it does not, rather than pretending to edit.

This is the cheap half of what an adversarial review called `TemplateV2`: the
blueprint becomes the durable semantic source, and the render spec becomes an
intermediate representation. It does not require rewriting the renderer or the
storage format, and nothing about it is lossy.

Verification: a test that creates a type, reads the blueprint back, changes one
field, updates, and asserts the new version renders differently while the old
version still renders as before. Plus an `eval:item-verbs` task phrased the way
a person would phrase it, asserting the workspace afterwards.

## Finding 2: an assistant-designed look cannot match a built-in

`src/lib/presentation/styles.ts` carries **166 CSS rules keyed to
`data-template="texttext.<id>"`**, covering the 11 built-in ids, and that
section is 54% of the file.

    grep -o 'data-template="texttext\.[a-z]*"' src/lib/presentation/styles.ts | wc -l

An assistant-created type gets an id like `runs-9eef4c`. It matches none of
them. So the visual quality that makes the built-in article look like an article
is unreachable by anything the assistant designs, however good its blueprint is.
Reducing the node vocabulary does not touch this.

**Fix.** Stop keying presentation off identity. Those rules describe a handful of
recurring intents - a magazine-weight masthead, a card grid with hairlines, a
reading measure. Give the theme an axis that names the intent, have the renderer
emit it as a data attribute, and rewrite the id-keyed rules against it. Any
type, built-in or assistant-designed, can then ask for the same treatment.

Scope honestly: this is the largest item here and it is presentation work with a
visual regression surface. It is staged after finding 1 and gated on the
screenshot baseline, and if the sweep cannot be finished safely it is better to
convert the highest-value families and say which remain than to convert all 166
carelessly.

Verification: `npm run evals` against the committed screenshot baseline, and a
new case that gives an assistant-designed type the same intent as a built-in and
asserts the rendered markup carries the same treatment.

## Finding 3: the browser assistant can do 24 of the 35 things

Three surfaces, three different policies, and only one of them is the one most
people will use.

| Surface | Tools |
| --- | ---: |
| External agent over MCP | 35 |
| Native assistant on this Mac | 35 |
| Cloud assistant in the browser | **24** |

The browser assistant cannot delete an item, publish or unpublish one, share
one, revoke sharing, restore from Trash, retire a look, or add a cover image
(`src/lib/ai/cloud-tools.ts:66`). Against "the AI can do anything to my items",
that is the goal failing in the default surface.

The stated reason is that the web path has no interactive confirmation
(`src/app/api/ai/route.ts:5`). But a confirmation mechanism already exists: a
write proposal is staged, the owner sees the exact validated arguments, and
nothing runs until they approve. The proposal surface then applies the same
`confirmation === "none"` filter to itself
(`write-proposal-policy.ts:34`), so it refuses to carry precisely the actions
that need it. The reasoning is circular.

**Fix.** Let confirmation-gated commands be staged as proposals. A staged
delete is strictly safer than the native path's, which executes behind a
callback: the proposal shows the owner the exact arguments and does nothing
until approved.

Deliberately NOT included: `add_item_asset` and `recapture_bookmark` fetch a
URL the model chose. Approving a proposal does not make an outbound fetch safe,
because the danger is in the fetch, not in the write. They stay excluded and the
comment will say so.

That takes the browser assistant from 24 to 33 of 35.

Verification: a test per newly proposable command asserting it stages, does
nothing before approval, and performs exactly the approved arguments after.

## Finding 4: 110 lines that look like the capability policy and are not

`workspaceAgentToolNamesForView` selects tools by matching regexes against the
person's words - `/\b(delete|remove|trash)\b/i` for `delete_item` and so on
(`agent-tools.ts:175`). It is assigned into the object `createWorkspaceAgentTools`
returns and **never called anywhere in the repository**:

    grep -rn "\.toolNamesForView(" --include="*.ts" --include="*.tsx" .   # nothing

The native assistant registers every definition instead
(`useNativeAssistant.ts:888`). Only its own test file keeps it alive.

It is worse than unused, it is misleading. Run the real phrasings through it and
17 of 20 lose the tool the request needs: "get rid of that note" gets no
`delete_item`, "ship it" gets no `set_item_status`, "what do I have about
caching" gets no `search`. Reading this file, the honest conclusion is that the
product is broken in a way it is not. I reached that conclusion myself an hour
ago and had to disprove it.

**Fix.** Delete the function, `PROMPT_TOOL_GROUPS`, `ITEM_AGENT_TOOL_NAMES`,
`WORKSPACE_BASE_TOOL_NAMES`, `ITEM_EDIT_TOOL_NAMES`, the field on the returned
object, and the tests that exist only to exercise them.

## Finding 5: goal two is under-evidenced where it matters most

`eval:item-verbs` covers add-section, retitle, summarise-into-note, tag-across
and a refusal. The owner's own words name things it does not cover: highlighting
the important parts of a note, and acting across several items in one request
beyond tagging.

**Fix.** Add tasks for those two, phrased as a person would phrase them, each
asserting the workspace afterwards. If either fails, that is a finding to fix,
not a test to soften.

## Order

1. Finding 4, delete the dead gate. No behaviour change, and it clears the
   misleading map before anyone reads it again.
2. Finding 3, proposals carry confirmation-gated commands. Self-contained,
   closes the largest goal-two gap.
3. Finding 1, persist and update blueprints. The largest goal-one gap.
4. Finding 5, evals for the uncovered verbs.
5. Finding 2, presentation by intent instead of identity. Largest and riskiest,
   last, and reported honestly if it cannot be finished.

Every step ends green: `npx tsc --noEmit`, `npm test`, `npm run lint`, and
`node --import tsx scripts/verify-template-render.ts` for anything touching
looks. Nothing is pushed red.

## What this plan does not do

- It does not rewrite the render spec into a new versioned format. An
  adversarial review recommended exactly that. Finding 1 takes the part of it
  that delivers the missing capability, at a fraction of the cost, and leaves
  the format question open rather than pretending to settle it.
- It does not reduce the node vocabulary further. The remaining merges need
  nested unions and buy a smaller grammar that no measurement here shows to be
  the binding constraint.
- It does not touch collaboration, which works.
