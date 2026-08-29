# The two goals, and what stands between us and them

Written 2026-08-29. Revised the same day against an adversarial review by
gpt-5.6-sol at max reasoning, which found the first draft wrong in four places
and missing the sharpest gap of all. Corrections are marked; the errors are left
visible because the reasoning that produced them is the reasoning to distrust.

**Goal one.** A person describes the kind of thing they want to keep and the
assistant builds it: what content it holds, and how it looks. Afterwards they
can keep changing the look by asking.

**Goal two.** The assistant can read, update and delete anything. Change a note,
summarise it, write a whole one, highlight the important parts, act on one item
or on many.

Constraints: it stays simple, people collaborate with each other, and people
collaborate with agents - "if I say I want you or Codex to work on a note, you
need to be able to do all these actions."

Everything below was measured on `main`, not remembered, and every claim names
the command that produced it.

## Finding 0: an agent on this Mac gets five verbs

**The sharpest gap against a stated goal, and the first draft of this plan
missed it entirely.** It claimed "Codex on this Mac gets all 35" and that was
simply false. (The registry has since grown to 36; counts below are as
measured on the day and are marked where they have moved.)

`/api/agent/commands` allows exactly five: `search`, `read_item`, `create_item`,
`update_item`, `append_to_item` (`src/app/api/agent/commands/route.ts:11`). The
interoperability document states it as a deliberate boundary: the local plugin
"does not gain comments, publishing, collaborator management, or the rest of the
hosted MCP surface through this route" (`docs/agent-interoperability.md:61`).

So "Codex, tidy up my notes folder" cannot move an item, tag one, comment on
one, change a status, restyle anything, or design a type. Against the owner's
own sentence about agents working on a note, this is goal two failing in the
exact surface named.

**Fix.** Widen the allowlist to the commands that are neither
confirmation-gated nor open-world - the same test the browser assistant already
applies to itself, which is a boundary this project has already reasoned about
once. That adds the folder, comment, look and organisation verbs and leaves
delete, publish, share and URL-fetching commands where they are.

Not a wholesale removal of the boundary. `delete_item`, `set_item_status`,
`set_access`, `revoke_access`, `add_item_asset` and `recapture_bookmark` stay
out, for the reasons the existing filter states.

Verification: a route test per newly allowed command, one asserting the still
excluded ones are refused, and `scripts/verify-agent-interoperability.ts`, which
already reads this route's allowlist and will need its expectation updated
deliberately rather than incidentally.

## Finding 1: an authored look cannot be reopened

Corrected from the first draft, which said "a look cannot be changed after it is
saved". Too broad: a human can import a compiled look with `mode: "update"` and
get a new immutable version today
(`src/app/editor/folder-template-actions.ts:133`). The true claim is narrower
and still bad:

**Nothing can reopen the blueprint an assistant authored, because it is thrown
away at save.** `document_templates` stores `definition` and has no column for
the blueprint (`src/lib/db/schema.ts:781`). The studio has no prop for an
existing type and its save always creates (`ItemTypeStudio.tsx:418`, `:775`).
There is no `update_item_type` on any surface. `list_document_templates` returns
the compiled definition, which is not the language the model writes in.

So "make the date bigger on my recipe type" means re-authoring the whole thing
blind from compiled output.

**Fix, revised.** The naked nullable column the first draft proposed is not
enough. The review found three reasons and each is real:

- **Store the normalized blueprint, not the submitted one.**
  `adaptCollectionToFields` rewrites layouts and field references before
  compilation (`item-type-blueprint.ts:1117`). Storing what arrived while
  rendering what compiled would give two different truths.
- **Version the envelope.** Blueprints carry no schema or compiler version, and
  the compiler dropped backward compatibility precisely because they were
  assumed transient (`item-type-blueprint.ts:70`). Persisting one makes that
  assumption false, so store
  `{kind, schemaVersion, compilerVersion, blueprint}` and refuse to reopen what
  a later compiler cannot honour.
- **Keep it out of `TemplateDefinition`.** That schema is strict and rejects
  unknown keys (`schema.ts:828`), and definitions travel inside sync envelopes.
  The authoring source is a sibling column, never a definition field, so no
  exported bundle changes shape and no older reader is broken.

`update_item_type` additionally needs a `base_version` so two people editing the
same base cannot silently create competing successors
(`store.ts:3694` reads latest and appends), and an explicit application target,
because a new immutable version changes nothing visible on its own - documents
pin exact versions by design (`store.ts:3384`).

Honest about what cannot be reopened: built-ins live in code and have no row
(`store.ts:3330`); a look saved from a document, a duplicate, an import and a
restored version all carry a definition and never had a blueprint
(`store.ts:3548`, `:3616`, `:3776`). Those stay editable by hand and must say so
rather than offering an edit that silently starts from nothing.

## Finding 2: identity CSS, and a live bug it already causes

`styles.ts` carries **166 selector occurrences** keyed to
`data-template="texttext.<id>"`. Corrected: the first draft called them 166
rules, and said they covered the 11 active built-ins. They do not.

    node --import tsx scripts/../<probe>   # 11 ids styled, but:
    #   ACTIVE with no id-specific CSS: texttext.timeline
    #   CSS for a RETIRED id:           texttext.newsletter

**Timeline is the bug already shipping.** It is Article with a different id -
"the item is the same article, field for field" (`templates.ts:85`) - and
because the renderer emits the id, none of Article's styling matches it. A
person who picks Timeline gets a visibly poorer Article. The same mechanism is
why `save_item_as_look` on an Article does not preserve the Article look: it
changes the id (`store.ts:3776`).

That is the whole problem in one visible case, and it is the honest reason to
care about this: not "assistant-designed types could be prettier" but "the
product already renders one of its own built-ins wrong."

**Fix, and its limit.** The review is right that a single intent attribute does
not solve it. Some rules key off authored structure and node ids - Brief's
`claims-ledger` and `sources-ledger` (`styles.ts:364`) - and no attribute makes
those nodes exist. So: convert the families that are genuinely generic, leave
the structural ones alone, and say which is which.

**This step has no verification gate and that is the reason it is last.**
`npm run evals` sets `process.exitCode = broken.length > 0 ? 1 : 0`, so blocked
suites exit zero (`run-evals.ts:215`); the sidebar-looks baseline is JSON shape
data and reports drift without failing; `verify-template-render.ts` checks
markup, not layout. The first draft cited these as the gate. They are not one.
Building a real light-and-dark visual check is a prerequisite for this finding,
not a detail of it.

## Finding 3: the browser assistant cannot delete, publish or share, and the first fix was unsafe

The measurement was 24 of 35 when taken. It is 25 of 36 now, because
update_item_type was added and needs no confirmation (`cloud-tools.ts:66`). No delete, publish,
share, restore, retire or cover image.

**The proposed fix was wrong and the review was right to refuse it.** The first
draft argued the exclusion was circular because a proposal shows the owner "the
exact validated arguments". It does not. Workspace proposals truncate strings
and JSON, hide `if_match_hash` and `idempotency_key`, show at most ten fields,
and say "Review changed fields" rather than the arguments
(`AssistantConversation.tsx:238`, `:260`, `:292`). And an id is not a semantic
preview: `restore_item` takes only an id and can restore an item to public
(`tools.ts:791`); `revoke_access` takes a grant id, not the person and the role
(`tools.ts:970`); item hashes are optional, so an omitted one disables the
stale-state check entirely (`tools.ts:111`).

The filter is an intentional trust boundary, not sloppy reasoning, and the
runbook says so (`docs/agentic-assistant-runbook.md:287`).

**Fix, replaced.** Command by command, not by deleting the filter. Freeze a
semantic preview at staging time - title, path, current audience, collaborator
and role, affected count - bind it to a state fingerprint, re-resolve at
approval and fail closed on drift. Begin with soft-deleting one item with a
mandatory hash, and treat publishing, restoring, folder subtrees and access
grants as separate designs.

Deferred behind Finding 0 and Finding 1, because it is a security design and
those two are capability work.

## Finding 4: done

240 lines of keyword-matching that selected the assistant's tools by regex and
was never called. Deleted in `aea66bcf`, with the six tests that existed only to
pin its output. The native assistant registers every definition instead
(`useNativeAssistant.ts:888`).

Worth recording why it mattered: reading it, the honest conclusion was that the
product was broken in its main surface. Seventeen of twenty ordinary phrasings
lost the tool they needed. I reached that conclusion and had to spend an hour
disproving it.

## Finding 5: goal two is missing primitives, not only tests

Corrected. The first draft proposed evals for highlighting and multi-item work.
Tests cannot create a capability that does not exist:

- **Highlight has no persistent representation.** The editor knows Markdown
  strong, emphasis and code (`MarkdownSurface.tsx:93`); the reader renders GFM
  (`DocumentRenderer.tsx:279`). Either "highlight" means bold, and it should be
  written down and tested as exact ranges, or it means a durable mark, and the
  content model, editor, renderer and collaboration path all need work.
- **There is no batch command.** `update_item` updates one item
  (`tools.ts:721`).
- **The browser loop stops at eight steps** (`api/ai/route.ts:56`). List, then
  one update per item, cannot reach an arbitrary "many".

The two eval tasks are written and stay, because they encode the requirement in
the person's own words. They are expected to fail until the primitives exist,
and a failing eval that names a missing capability is worth more than no eval.

## What has shipped

Verified by a second adversarial pass, which found real defects in every one of
the first four commits. Those are fixed and listed below with them.

- **Finding 4** (`aea66bcf`). 240 lines of dead keyword-gating deleted.
- **Finding 0** (`41d1d56b`, corrected in `5cf36029`). An agent on this Mac has
  25 commands, not five. The first version DERIVED the set from
  `confirmation === "none" && !openWorldHint`, which is wrong because
  `confirmation` defaults to `"none"`: a command added later would have joined a
  local agent's authority silently. It is now an explicit decision per command,
  with a test that fails when a new command is in neither list, and a second
  test asserting nothing confirmation-gated or URL-fetching is allowed.
- **Finding 1** (`c14dc7db`, corrected in `716385c5`). Authoring source in a
  versioned envelope holding the normalised blueprint; `update_item_type`;
  `list_document_templates` reports what can be reopened. The corrections
  mattered: the update fetched the authoring source and never read it, so an
  imported or saved-from-a-document look could be replaced wholesale; it was not
  compare-and-swap, because the check and the insert read the version
  separately; the restyling remainder was discarded so a folder of 700 read as
  finished at 500; folders deliberately pinned to an older version were
  upgraded anyway; and four different reasons a look could not be reopened were
  reported as one.
- **Concurrent writes** (`7d04238e`). Restyling a folder read every row up front
  and wrote each back from that snapshot with no revision guard, so a
  collaborator's edit between the scan and the save was silently replaced. Every
  write is now guarded by the revision it was read at. Verified against the real
  local database, because there is no database-backed test infrastructure here.
- **Comment permission** (`ab044254`). `add_comment` resolved an item's access
  and never looked at it, so read access was permission to write.
- **Timeline** (`7865be1b`, tests fixed in `716385c5`). Article's styling keys on
  a family both looks carry. The tests were vacuous: the renderer inlines the
  stylesheet, the stylesheet now contains the selector, so asserting on the
  whole output matched the CSS rather than the element.
- **Highlight** (`41ee5d97`). `==like this==` renders as a mark. A real model,
  asked only to highlight the important sentence, uses it correctly.
- **Steps** (`9036b5dd`). The browser assistant stopped at eight steps, which is
  one short of putting a different line in three notes. Now 24, and reaching the
  ceiling is reported rather than passed off as a finished answer.
- **Studio** (`d2d83039`). Opens on an existing look, starts its history from
  the blueprint that look was built from, and saves a new version. The workspace
  UI has no button for it yet.

## Order for what is left

Revised against the verification pass, which called the previous order wrong.

1. **Test the local CLI end to end**, executable to real executor. The allowlist
   is explicit and tested; nothing proves the widened commands actually run
   through the route.
2. **A soft delete an agent may perform**, with an explicit confirmation on the
   local and browser surfaces. Delete is the most-wanted of the denied verbs.
3. **Bounded batch operations** with stated partial-failure semantics. Raising
   the step ceiling helps small jobs; it is not a batch command.
4. **A real light and dark visual gate**, and only then the remaining identity
   CSS. `npm run evals` exits zero when suites are blocked, so there is no gate
   today.

## What this plan declines, and what it admits

Declined: the render-format v2 rewrite; further node-vocabulary reduction; any
change to collaboration.

Admitted limitations this plan does not remove:

- The local CLI stays short of the hosted surface even after Finding 0: delete,
  publish, share and asset fetching remain out by design.
- The in-app assistant is owner-only; a collaborator's edit access is not
  assistant authority (`runbook:58`).
- Delete means Trash. There is no permanent-delete command
  (`agent-interoperability.md:246`).
- There is no Plan mode and no general batch.
- Built-ins, imports, forks and saved looks cannot be losslessly reopened as
  blueprints, and will say so rather than pretend.
- There is no enforceable visual regression gate. The runbook already lists this
  as a known gap (`runbook:647`).
- The claim "eval:item-verbs passes" has no dated receipt in the repository. It
  is re-run, or it is not claimed.
