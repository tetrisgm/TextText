# Category-defining agentic text loop

Written 2026-08-31 from the current `main` implementation, the observed MVP
workflow, and a fresh comparison with Paper, Pen, and Notion AI. This is an
implementation plan, not a claim that the work below already exists.

## Goal

Make TextText feel as direct, fast, and dependable for text as the best
agentic design canvases feel for design.

A person or an authorized AI should be able to capture material, identify the
right context, retrieve the right source passages, make a visible change,
verify the rendered result, and recover from that change without understanding
TextText's schemas, command names, provider architecture, or transport.

The category claim at completion is:

> TextText is the fastest place for people and their AI tools to share durable
> text.

The product loop is:

```text
Capture -> retrieve -> change visibly -> verify -> continue anywhere
```

## Terminal proof

The goal is complete only when this exact workflow has been observed in a
Store-compatible build against an isolated workspace:

1. A new person signs in and connects one supported AI without a terminal,
   pasted bearer token, API-key explanation, or localhost service.
2. They rapidly capture five messy notes or links without leaving Library.
3. They ask: "Turn these into a concise launch brief. Keep every factual claim
   tied to the source it came from."
4. The assistant immediately names the folder or items it is reading, creates
   the brief, opens it, and shows claim-level source links.
5. The person selects one passage and asks for a shorter version. The exact
   replacement is previewed and applied without touching other text.
6. The assistant inspects the final document as rendered and reports any
   structural or source problem before claiming success.
7. One Undo agent turn action restores every change from the last turn or
   refuses safely because a collaborator changed one of the affected items.
8. A separately connected external AI finds the same brief, reads the cited
   sources, appends one guarded paragraph, and returns a TextText receipt.
9. Restarting the app preserves the captures, brief, citations, conversation,
   change history, and external-agent attribution.

Passing unit tests is necessary but is not terminal proof. The visible result,
the real model behavior, the stored data, and recovery must all be observed.

## Existing foundation to preserve

- One validated schema-v1 `DocumentSnapshot` is the content source of truth.
- The UI, in-app assistant, local CLI, and hosted MCP reach one canonical
  workspace-command layer.
- Notes and bookmarks remain private and unlisted. Visibility fails closed.
- Every connected mutation is permission checked, revision fenced, attributed,
  and audited.
- Delete means Move to Trash. Permanent Empty Trash remains an explicit owner
  confirmation.
- Library capture stays in place and returns Open and Undo.
- Current workspace, folder, document, and selection context already exist for
  the in-app assistant.
- Local-first collaboration, provider-key isolation, App Sandbox rules, and
  the deliberate release process remain unchanged.
- The 38 canonical commands remain the deterministic internal and public
  capability surface. This plan simplifies what a model sees; it does not
  delete capabilities or move authorization into the model layer.

## Product decisions

### One agent loop, not more features

This goal improves the success rate, legibility, speed, and activation of the
existing product. It does not add more item types, looks, chat-management
features, providers, or generic automation.

### The document is the result

Chat explains progress and holds review controls. The durable document is the
work product. A successful turn always identifies the source context, changed
items, completed operation, rendered result, and recovery action.

### Context is explicit at trust boundaries

The in-app assistant may use the visible workspace, folder, item, and
selection. A hosted external agent receives only its authorized workspace and
the items or context explicitly named by the person. No remote client silently
learns what happens to be open in the app.

### No new authority

Tool simplification, argument repair, retries, and Undo never widen access or
skip confirmation. If a safe repair cannot be proven, the operation fails with
one concrete recovery action.

## Workstream 1: compact model-facing agent contract

### Problem

The canonical surface has 38 tools. That is appropriate for deterministic
clients but too much simultaneous choice for a model. The model can choose the
wrong sibling operation, send an argument that only another command accepts,
or spend several turns discovering a path the product already understands.

### Build

1. Add a separate model contract with at most these intent-level families:
   `inspect_context`, `search_texttext`, `read_texttext`, `create_texttext`,
   `edit_texttext`, `organize_texttext`, `publish_or_share_texttext`, and
   `recover_texttext`.
2. Define each family as a strict discriminated schema. Compile it into the
   existing canonical commands after validation. Never execute an intent
   directly against storage.
3. Register only the families available in the current context and trust
   boundary. Read-only turns do not receive write families. Store and browser
   turns do not receive standalone-only capabilities.
4. Keep the full canonical MCP surface for deterministic clients, but make the
   compact contract the recommended agent surface and expose its guide as an
   MCP resource.
5. Add a bounded repair layer for harmless, provable mistakes: legacy aliases,
   title-to-id resolution after an exact unique match, append spelling, and one
   reread/retry for an atomic append conflict. Never repair audience, access,
   deletion, publication, or ambiguous identity.
6. Remove raw schema and validation dumps from the product UI. Name the failed
   operation and one precise recovery instead.
7. Record model tool choice, repair class, step count, duration, and terminal
   status without recording document content.

### Primary files

- `src/lib/ai/tools.ts`
- `src/lib/ai/agent-tools.ts`
- `src/lib/ai/cloud-tools.ts`
- `src/lib/ai/system-prompt.ts`
- `src/lib/mcp/agent-surface.ts`
- `src/components/workspace/assistant/useNativeAssistant.ts`
- `src/app/api/ai/route.ts`

### Acceptance

- The model sees no more than ten TextText tools in any turn.
- All current canonical capability, authorization, confirmation, and audit
  tests continue to pass below the adapter.
- Thirty ordinary create, find, append, targeted edit, organize, and item-type
  prompts complete with no raw tool error shown to the person.
- A newly added canonical command cannot join a model family without an
  explicit mapping and test.
- The previous append-versus-update failure is represented by at least five
  paraphrases and passes on every supported model lane.

## Workstream 2: inspect and verify the actual document

### Problem

TextText can tell an agent what commands succeeded, but the agent cannot fully
inspect the final semantic and rendered state the person sees. Design agents
feel grounded because they can inspect selection, hierarchy, computed output,
and a screenshot before finishing.

### Build

1. Implement `inspect_context` for the in-app assistant. Return the stable
   workspace, folder, item, selection, document outline, visible fields,
   template reference, collaboration state, and pending proposal state.
2. Implement a bounded `inspect_document` result for every agent channel. It
   returns the validated snapshot summary, heading outline, field values,
   links, source citations, asset references, visibility, current hash, and a
   stable deep link.
3. Add an explicit Use with connected AI action for an item or selection. It
   creates a short-lived, workspace-scoped context capsule containing the item
   id, field, guarded range anchors, and source hash, but no bearer credential.
   An already authorized hosted client can resolve it through MCP. This gives
   an external AI Paper-like selection context without silently exposing what
   is open in the app.
4. Add `preview_document` for supported in-app and hosted contexts. Render the
   exact shared `DocumentRenderer` output in a deterministic viewport and
   return a bounded image plus accessible text summary. The preview route must
   recheck item access and never make a private URL public.
5. Add deterministic structural checks: missing source targets, broken
   internal links, empty required fields, duplicate headings, invalid template
   bindings, clipped or failed render nodes, and unpublished-source warnings.
6. Require complex generation turns to inspect the result after mutation.
   Simple capture, title, tag, append, and exact selection edits may finish
   from their mutation receipt.
7. Show verification beside the changed document, not as a long assistant
   monologue.

### Primary files

- `src/components/document/DocumentRenderer.tsx`
- `src/components/document/UnifiedDocumentReader.tsx`
- `src/components/workspace/assistant/context.ts`
- `src/lib/ai/agent-tools.ts`
- `src/lib/mcp/tools.ts`
- `src/app/api/ai/tools/route.ts`

### Acceptance

- The agent can name the exact open item and selected source range without the
  person repeating either one.
- A hosted agent can resolve only a person-shared, unexpired context capsule
  from its already authorized workspace. The capsule is useless in another
  workspace or without the underlying item permission.
- A generated brief is inspected as structured data and rendered output before
  completion.
- The verifier catches intentionally broken source links and invalid required
  fields in light and dark mode fixtures.
- A private preview cannot be opened without the same item access.
- A successful complex turn links directly to the inspected document.

## Workstream 3: grounded retrieval and passage citations

### Problem

Current retrieval is bounded lexical search plus exact reads. It is safe, but
it misses conceptual matches and provides source-item receipts rather than
claim-level evidence.

### Build

1. Add a normalized Postgres full-text search projection with a migration,
   access-filtered query, ranking, and deterministic local fallback.
2. Combine full-text score with title, exact phrase, folder, tag, wiki-link,
   recency, and current-context signals. Do not replace exact matching with a
   model.
3. Add bounded query expansion and candidate reranking inside an already
   authorized provider turn. The first implementation does not require a new
   embedding provider, persistent background indexer, or TextText-funded model.
4. Read only the top bounded candidates needed for an answer. Search snippets
   still do not count as read evidence.
5. Add a stable passage citation shape: item id, item version or hash, field,
   bounded source range, prefix/suffix anchors, and quoted excerpt.
6. Render citation markers next to the exact answer claim and source links in
   the resulting durable document. Reopening a citation reports when its source
   version changed.
7. Add related-item discovery using the same ranked substrate.
8. Add source-scope controls for current item, selected items, folder,
   workspace, and explicitly connected sources. Default to the narrowest
   useful scope.

### Primary files

- `src/lib/workspace-search.ts`
- `src/lib/store.ts`
- `src/lib/db/schema.ts`
- `src/lib/ai/system-prompt.ts`
- `src/lib/ai/agent-tools.ts`
- `src/components/workspace/assistant/AssistantConversation.tsx`
- `src/app/api/workspace/search/route.ts`

### Acceptance

- A 10,000-item fixture returns first search results within the performance
  budget and never leaks an inaccessible candidate.
- The retrieval suite contains exact, paraphrased, conceptual, temporal,
  folder-scoped, linked, and adversarial queries.
- At least 90 percent of a reviewed relevance set places a useful source in
  the top five.
- Every factual claim in the flagship brief links to an exact passage and
  source version.
- Changing a source makes the citation visibly stale rather than silently
  presenting it as current.

## Workstream 4: one change set and one Undo per agent turn

### Problem

Selection proposals have Apply and Undo, while broader direct, multi-item, and
external-agent changes do not share one uniform recovery model. Audit answers
who did something; it does not provide a person-facing turn rollback.

### Build

1. Add an `agent_change_sets` envelope owned by workspace, person, agent,
   conversation, and turn. Store affected item ids, canonical command receipts,
   before hashes, after hashes, bounded semantic summaries, and inverse data.
2. Create the change set below the native, cloud proposal, CLI, and MCP
   adapters so every connected lane participates.
3. Group all mutations from one assistant turn into one visible card. Show
   sources read, items changed, operations, current status, Open, and Undo.
4. Undo only when every affected item still matches the recorded after state.
   If one changed, refuse the group rollback and show the conflicting item.
5. Use inverse canonical commands where safe. For text replacement retain the
   exact prior document snapshot. For Move to Trash use restore semantics. Do
   not invent a reversible form of Empty Trash or external side effects.
6. Keep change-set retention bounded and owner-readable. Audit history remains
   immutable even when content is undone.

### Primary files

- `src/lib/db/schema.ts`
- `src/lib/ai/write-proposals.server.ts`
- `src/lib/ai/agent-tools.ts`
- `src/lib/mcp/tools.ts`
- `src/components/workspace/assistant/AssistantConversation.tsx`
- `src/components/workspace/assistant/useNativeAssistant.ts`

### Acceptance

- A one-item edit, a five-item organization turn, a type update, and a soft
  deletion each produce one change-set card.
- One Undo restores the exact prior state in all four cases.
- A simulated collaborator edit after the agent turn blocks unsafe Undo and
  preserves both people's work.
- Empty Trash, publication, access changes, and outbound network effects never
  claim universal reversibility.
- Every applied and undone command retains its audit trail.

## Workstream 5: one-click authorized external AI connection

### Problem

The hosted MCP bearer flow is secure but not category-grade activation. A
person should not need to understand tokens or transports to let a compatible
AI use TextText, especially in the sandboxed Store edition.

### Build

1. Implement the current MCP authorization profile through official resource
   and authorization-server metadata.
2. Support OAuth 2.1 authorization code flow with PKCE S256, exact redirect URI
   validation, short-lived access tokens, rotating refresh-token families,
   revocation, state validation, and owner consent.
3. Keep scopes explicit: read-only and read/write. Publication, access,
   permanent deletion, and outbound network work retain their existing
   confirmation semantics after authorization.
4. Support pre-registered clients first. Add dynamic client registration only
   when required by a tested target client and after its security review.
5. Build one connection page with tested Add to or setup actions for supported
   clients. State edition limitations before connection.
6. Complete connection with the same private round trip: create a private
   connection-check note, read it back, show its location, and offer removal.
7. Settings remains the single inventory for provider, native, client, and MCP
   connections, with last successful verification and Disconnect or Revoke.
8. Do not restore a localhost server or give the Store app shell access.

### Primary files

- `src/app/.well-known/mcp.json`
- `src/app/api/mcp/route.ts`
- `src/lib/mcp/auth.ts`
- `src/lib/db/schema.ts`
- `src/app/connect/`
- `src/components/workspace/WorkspaceSettings.tsx`

### Acceptance

- A fresh Store-compatible installation connects one supported external AI in
  under 90 seconds without terminal work or a pasted secret.
- Consent names the workspace, client, scopes, and revocation path.
- Read-only access cannot mutate. Revocation invalidates both access and refresh
  credentials. Refresh-token replay revokes its family.
- Cross-workspace, redirect, PKCE downgrade, consent replay, and confused-deputy
  tests fail closed.
- The private connection-check note appears in TextText and can be removed
  through the normal reversible content workflow.

## Workstream 6: make the flagship workflow the onboarding

### Problem

TextText has good documentation and seven recipes, but explanation is carrying
work the product itself should perform. The first experience should prove the
category, not teach architecture.

### Build

1. Make one flagship action prominent after the first captures: Turn these
   notes into a sourced brief.
2. Offer an optional isolated sample set when the workspace has no suitable
   material. Sample content must be clearly labeled and removable in one
   reversible action.
3. A Try action preselects the source scope, fills the concise prompt, and
   leaves submission to the person.
4. Open the real resulting document automatically. Show citations, verification
   status, change-set card, and the next selection-refinement action in context.
5. Let plain-language item-type creation run directly from the assistant:
   "make me a project tracker" produces the folder, reusable type, and first
   item. The studio remains available for inspection and manual editing but is
   not a prerequisite.
6. Replace long setup errors with the one action that repairs the current
   connection. Do not narrate provider or transport architecture during the
   successful path.
7. Keep the public prompt gallery concise: prompt, real result, Try. Existing
   deeper documentation remains reference material.

### Primary files

- `src/components/PostWorkspaceShell.tsx`
- `src/components/workspace/assistant/AssistantSidebar.tsx`
- `src/components/workspace/ItemTypeStudio.tsx`
- `src/app/docs/recipes/page.tsx`
- `src/app/docs/getting-started/page.tsx`

### Acceptance

- Four of five people unfamiliar with TextText complete capture, brief,
  refinement, and Undo without verbal help.
- The first useful durable document appears within three minutes after sign-in.
- The successful path contains no token, MCP, schema, blueprint, provider, or
  transport explanation.
- The same prompt produces the same supported document structure through the
  in-app assistant and one external AI.

## Workstream 7: performance and real-model release evidence

### Product service objectives

- Keystroke to local paint p95 below 32 ms.
- Cached item open p95 below 100 ms.
- Local capture acknowledgement p95 below 150 ms.
- Durable capture acknowledgement p95 below 1 second.
- First search results p95 below 300 ms in a 10,000-item workspace.
- First meaningful assistant progress p95 below 1 second.
- Ordinary find, read, append, title, tag, and selection-edit turns complete
  p95 below 8 seconds on a healthy provider.
- Fewer than 1 percent of ordinary turns end in an unrepaired tool-schema
  failure.
- At least 95 percent of golden agent tasks complete without manual retry.

### Build

1. Extend content-blind app health with capture, cached open, search, assistant
   first-progress, first-answer, tool steps, repairs, and completion duration.
2. Add 10,000-item and large-document fixtures. Measure list hydration, search,
   open, editor typing, collaboration, and assistant context construction.
3. Build a real-model evaluator with at least 30 task meanings and five natural
   paraphrases each. Cover capture, exact and conceptual retrieval, grounded
   answer, create, append, targeted rewrite, organization, type creation,
   verification, conflict, confirmation, and Undo.
4. Run each task through the supported native, configured cloud, and hosted MCP
   lanes where applicable. Record only fixture ids, tool choices, durations,
   terminal status, and scored assertions.
5. Mutation-test the evaluator so every gate is proven capable of failing.
6. Keep the bounded deterministic subset in the normal release gate. Run the
   network-variable real-model suite deliberately before a release claim, not
   from a timer or persistent job.
7. Fail a category-release claim when the golden completion, error, safety, or
   latency thresholds regress.

### Primary files

- `docs/app-health.md`
- `src/lib/app-health.ts`
- `src/lib/app-health-rollup.ts`
- `scripts/run-evals.ts`
- `scripts/verify-release.ts`
- `scripts/eval-native-codex-runtime.mjs`

### Acceptance

- Every service objective has a repeatable fixture and a production-safe
  content-blind metric where applicable.
- The real-model report compares prompt meaning, model lane, success, steps,
  repair count, and duration.
- Breaking one tool mapping, citation anchor, Undo guard, or latency threshold
  makes the corresponding evaluator fail.
- The terminal proof passes twice from clean app state without manual repair.

## Dependency order

1. Freeze the terminal fixtures, task meanings, safety invariants, and baseline
   measurements before changing the agent surface.
2. Build the compact model contract and repair layer.
3. Add context inspection and document verification.
4. Add full-text ranking, reranking, and passage citations.
5. Add cross-lane change sets and guarded Undo.
6. Add hosted MCP OAuth and the verified connection round trip.
7. Turn the flagship workflow into first-run product activation.
8. Run the complete performance, real-model, security, and visible terminal
   proof. Fix findings before making the category claim.

Each step lands in small coherent commits on `main`, with the project's own
tests run before push. No step waits for a release. Deployment, TestFlight,
App Store Connect, installation, and public release remain separate owner
decisions.

## Required evaluation matrix

| Capability | In-app provider | Standalone native | Hosted external AI |
| --- | --- | --- | --- |
| Capture and receipt | Required | Required | Required |
| Exact and conceptual retrieval | Required | Required | Required |
| Passage citations | Required | Required | Required |
| Create sourced brief | Required | Required | Required |
| Selection-targeted edit | Required | Required | Context-dependent |
| Atomic append | Required | Required | Required |
| Five-item organization | Required | Required | Required |
| Plain-language item type | Required | Required | Required |
| Rendered verification | Required | Required | Required when authorized |
| Change-set card and Undo | Required | Required | Required |
| Stale collaborator conflict | Required | Required | Required |
| Publish, access, Trash confirmation | Required where exposed | Required | Required where exposed |

Every required cell asserts the visible receipt, durable mutation, attribution,
audit row, source evidence, conflict behavior, and recovery. A channel may have
a narrower authority, but it may not claim work it did not perform.

## Explicitly outside this goal

- A Slack, Drive, Jira, GitHub, mail, or calendar connector gallery
- Cross-service indexing owned by TextText
- Scheduled or event-triggered background agents
- A general Plan mode
- Arbitrary unbounded batch operations
- New document primitives, item kinds, or look families
- A larger provider or model picker
- Team skill libraries or automatically learned skills
- Audio and video transcription
- A code-execution sandbox
- iPhone and iPad applications
- Broad Apple Notes, Notion, or Obsidian migration tools
- General DOCX or PDF publishing pipelines

Those can become later goals. First-party connectors come after TextText's own
retrieval and citations are excellent. Mobile capture and broad import/export
come after the desktop agent loop meets the terminal proof.

## Stop conditions

Stop and report rather than broadening the goal when:

- Semantic retrieval would require a new paid model or long-lived indexing
  service. Land full-text, relationship ranking, reranking, and citations first,
  then present the recurring-cost decision separately.
- A target MCP client requires a nonstandard authorization flow or unsafe token
  handling. Keep the standards-compliant server and name the incompatible
  client.
- Group Undo cannot prove every affected item still matches its recorded after
  state. Refuse the rollback instead of partially guessing.
- Rendered preview would expose a private document through a public asset URL.
- Performance work needs production content or document-bearing telemetry.

## Goal completion record

When the goal is complete, update this section with:

- final source commit
- observed terminal-proof build and workspace
- supported connection paths tested
- golden-task success and tool-error rates
- p95 performance results
- security and permission results
- remaining explicit product gaps
- deployment, TestFlight, and release state

Until those facts exist, this document remains a plan and TextText should make
the narrower claim already recorded in `docs/agentic-text-product.md`.
