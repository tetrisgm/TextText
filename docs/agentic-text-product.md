# The agentic text product

TextText should be the fastest durable writing home for people and agents.
The product is successful when a person can save material before deciding how
to organize it, then let any authorized AI retrieve or change that material
without losing context, attribution, or control.

This is the text equivalent of an agentic design canvas. The document remains
the source of truth. The agent works on it visibly.

## The four loops

### 1. Capture instantly

Library is an inbox, not a form that sends the person somewhere else.

- Press C in Library to focus capture.
- Paste a thought, URL, meeting note, excerpt, or useful AI answer.
- Press Enter to save and remain in Library. Shift+Enter adds a newline.
- Route URLs to Bookmarks and other material to the appropriate writing folder.
- Show an immediate receipt with the saved title, destination, Open, and Undo.
- Keep system Share Extension capture available outside TextText.

Acceptance: the person receives visible local feedback in under one second and
can save another item without navigating.

### 2. Retrieve from any authorized AI

An item saved once should be available through every supported agent channel.

- The in-app assistant reads the visible document, folder, selection, or
  workspace context.
- Claude and Codex on this Mac use the signed-in `texttext` CLI in the
  standalone edition.
- Remote agents use authenticated hosted MCP.
- Reads name the exact item or folder and do not mutate content.
- Channel limitations are stated before setup, not after failure.

Acceptance: the same private test note can be found and read back through each
supported channel without copying it into another app.

### 3. Make a visible change

Agent work belongs to a document, not an abstract chat transcript.

- The rail always shows the current document, folder, selection, or workspace.
- Progress names useful operations such as reading six notes or drafting in a
  named document.
- Connected edits carry an agent label, use guarded commands, and write audit.
- Selection quick actions preview the exact replacement before Apply.
- Conflicts fail clearly instead of overwriting unseen human work.

Acceptance: the person can point to the document that changed, the agent that
changed it, and the operation that produced the change.

### 4. Verify and recover

Setup is complete only after a visible round trip.

- Use one universal check: create a private note named Agent connection check,
  include the agent name, read it back, and report its location.
- Keep the test private and require the note to appear in TextText.
- Selection proposals expose Apply and Undo beside the result.
- Every mutation is attributed and audited through the shared command surface.
- Failures offer a precise retry or settings action without waiting monologues.

Acceptance: connection proof, mutation proof, and recovery are visible in the
product rather than inferred from configuration.

## Channel truth

| Channel | Primary writing path | External agent path |
| --- | --- | --- |
| Browser and App Store edition | In-app assistant with a workspace provider key | Hosted MCP from a separate compatible client |
| Standalone Mac edition | Eligible connected ChatGPT or Codex account, or a workspace provider key | Signed-in local Claude/Codex plugin, with hosted MCP optional |

The App Store application is not an MCP client and does not ship the local CLI
or Codex runtime. Browser and Store surfaces must never advertise those paths.

## What stays out of the primary experience

- No AI marketing card above Library.
- No duplicated connection explanation in Home, the rail, and Settings.
- No provider architecture, token export, or shell setup before the first task.
- No unsupported ChatGPT custom-app promise.
- No loopback MCP server restored for local agents.
- No generic agent marketplace until capture, retrieve, change, and verify are
  fast and repeatably proven.

## Competitive evidence

Pen demonstrates three ideas worth keeping: canvas selection becomes automatic
agent context, prompts show concrete visible results, and verification happens
in the canvas. See <https://www.pen.dev/prompts>,
<https://docs.pen.dev/getting-started/ai-integration>, and
<https://docs.pen.dev/core-concepts/pencil-interface>.

Paper demonstrates an even clearer activation model: connect the agent, run a
tiny visible task, then graduate to real cross-app recipes. See
<https://paper.design/docs/mcp> and <https://paper.design/>.

TextText should copy the clarity, not the design-product vocabulary. Its proof
is a saved note, a grounded draft, a visible edit, and an attributed Undo path.

## Competitive inventory

The useful comparison is not a feature count. It is how quickly each product
turns intent into a visible, recoverable artifact.

| Bar set by Pen or Paper | Text equivalent | Product requirement | Current proof |
| --- | --- | --- | --- |
| One sentence category promise | A fast document inbox for people and agents | The landing page says capture, durable document, and compatible AI before templates or publishing | Public landing contract and visual sweep |
| Copy a prompt and see the result | Copy a writing recipe and see the resulting document | Each recipe includes exact context, prompt, expected document, and recovery | `/docs/recipes` plus real product screenshots |
| Current canvas or selection is automatic context | Current workspace, folder, document, or selection is automatic context | The composer names its current context and selection actions do not require re-explaining the document | Assistant rail context chip and selection actions |
| A tiny visible connection check | Create and read back one private note | Every supported connection guide ends in the same one-minute check | Connect page, starter guide, and agent integration contract |
| Agent tools operate on one native artifact | Agents and the app use one schema-v1 document | CLI, in-app assistant, and hosted MCP use the shared workspace command layer | Interoperability verifier and command-route tests |
| Immediate canvas feedback | Immediate save, useful progress, and named result | Capture acknowledges in under one second; simple agent work shows progress immediately and finishes within a bounded window | In-place Library receipt and native/runtime evals |
| Screenshot and visual inspection | Open the changed document and identify the exact result | Completion links to the document, mutation audit names the actor, guarded selection rewrites offer Apply and Undo | Native bridge eval and recipe screenshots |
| Plugin-first setup | Local Claude and Codex connection in the standalone Mac edition | No copied workspace token or loopback server in the primary local flow | Plugin parser and agent integration verifier |
| Cross-app recipes | Turn research, conversations, and project history into durable writing | Recipes start from a real source, name the destination, and show the final document | Writing Recipes documentation |

## What TextText must be unusually good at

### Capture latency

Text products lose when capture asks the person to classify work before it
exists. Library must behave like an inbox:

- C focuses capture from anywhere in Library.
- Enter stores the material without navigation.
- URLs become bookmarks; text becomes a note in the chosen writing context.
- The receipt names the destination and offers Open and Undo.
- Focus returns to capture so ten fragments are as easy as one.

North-star measure: keyboard to durable acknowledgement in under one second,
with no route change.

### Agent retrieval quality

An agent must not guess from titles or narrate that it is waiting. A workspace
summary should receive a compact recent-content index immediately, then request
specific full documents only when needed. Reads must name their scope, stay
read-only, and fail with one exact recovery action.

North-star measure: useful visible progress in under one second and an ordinary
workspace summary in under ten seconds on a healthy connection.

### Mutation legibility

Chat is secondary. The document is the result. Every successful writing task
must answer four questions in the interface:

1. What context did the agent read?
2. Which document changed?
3. What operation completed?
4. How can the person review or recover?

North-star measure: no successful task ends with an orphaned answer that makes
the person search for the artifact.

### Connection confidence

Configuration is not proof. The same private note round trip verifies local
Claude, local Codex, in-app providers, and hosted MCP where supported. The UI
must show Connected only after a real read or write succeeds.

North-star measure: a new connection reaches a visible private document result
without requiring the person to understand tokens, transports, or provider
architecture.

## Deliberate simplification

TextText is not trying to become an IDE, a generic automation canvas, or an
agent marketplace. The primary product has four surfaces:

1. Library is the inbox and retrieval surface.
2. The document is the editing and collaboration surface.
3. The assistant rail is the visible agent surface.
4. Settings manages connections after the first successful task.

Templates, publishing, item types, collaboration, and MCP remain powerful, but
they do not get to interrupt capture or first-run understanding.

## Proof dashboard

| Claim | Status | Gate |
| --- | --- | --- |
| Capture stays in Library and offers Open and Undo | Implemented | Rapid-capture contract plus visual browser check |
| Native Quick Capture preserves failures and offers exact Open and guarded Undo | Implemented in source | Quick Capture tests plus isolated light and dark app proof |
| New and returning Library sessions hydrate to the same first frame | Implemented | Fresh-tab hydration check and pool server snapshot |
| Local Claude and Codex avoid workspace-token setup | Implemented | Agent integration verifier |
| Hosted MCP is scoped, revocable, and tenant isolated | Implemented | Token MCP live loop and route tests |
| Added TextText context is canonical and access checked | Implemented | AI route authorization tests and exact Read receipts |
| Native summary uses the supplied workspace index before tools | Implemented | Native bridge prompt proof plus prior real Codex zero-tool run; latest live rerun is account-capacity blocked |
| Agent edits are guarded, attributed, and audited | Implemented | Native bridge, collaboration, CLI command, and atomic-audit tests |
| Selection rewrite supports preview, Apply, and Undo | Implemented | Native bridge proposal leg and UI tests |
| Touch ID, Google provider consent, and TestFlight distribution | Owner validation deferred | Interactive owner test, then TestFlight gate |

The proof dashboard is intentionally narrow. A green unit test cannot replace a
visual result, and a visual result cannot replace an authorization or data
integrity test. A release claim needs both kinds of evidence when both apply.

## Release acceptance

Before a product claim is published, run the same canonical prompt through the
supported in-app, local plugin, and hosted MCP channels where applicable.
Assert the response, document mutation, attribution, audit entry, conflict
behavior, and recovery. Documentation grows only with exercised behavior.
