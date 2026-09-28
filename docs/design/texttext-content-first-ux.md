# TextText: one content-first, multiplayer, agentic application

You are working in the existing TextText repository. Implement the following coherent product direction. This is the complete brief: it combines the visual/interaction redesign, TextPack customization, human-and-agent collaboration, simpler agent onboarding, performance requirements, and crash-recovery discipline. No earlier conversation or separate prompt is required.

Inspect what is already implemented and retain working improvements. Do not restart completed work or replace implementation with another expansive architecture proposal. Implement in small, verified slices.

## 1. The product and the boundary

TextText is a beautiful, extremely fast place to write, collect, read, and work together with people and agents.

It handles notes and longer writing/blogging, saved links/read-later, images/GIFs/visual references, RSS, and related documents. These are not separate applications sharing a sidebar. They are items in folders, persisted through the existing TextPack model, with excellent content-appropriate templates and one convenient way to work with an agent.

The user experience is:

> Write something, paste a link, or drop an image. Put it in a folder. Open it in an excellent reader, editor, or viewer. Work on the same material with other people and your agent. Change its presentation when that would make it more useful.

The underlying model remains:
- Items and folders provide identity and organization.
- Existing TextPack content, Markdown, metadata, assets, and template definitions remain authoritative.
- Templates provide useful presentations and supported interactions, not separate hidden databases.
- The existing shared commands, permissions, collaboration, revisions, and agent tools operate on those same items.

Almost no decisions when adding content. Considerable flexibility when working with it.

The app must be excellent without an AI account. AI enhances working and customization; it is not required for saving, writing, reading, finding, sharing, or rendering an existing template.

### Non-goals

Do not bring in Webweb, browser replacement, embedded Chromium, a companion-browser architecture, browser automation, scheduled-job systems, a new plugin marketplace, a workflow canvas, or a separate dashboard builder. Those earlier explorations are not this task.

Do not introduce a second agent framework, parallel tool registry, AI-only file format, duplicate template store, or another editor merely to reorganize the UI. Do not migrate storage simply to rename navigation.

Use composability underneath: one real implementation of a behavior can serve a keyboard command, a contextual control, and the agent. That is a reuse principle, not permission to build a general-purpose platform.

“Markdown-backed” does not mean encoding original images or GIFs into text. Preserve binaries through the existing TextPack asset mechanism. Verify how the current format actually represents them.

## 2. Visual references are the quality standard

Inspect representative actual interfaces, screenshots, and product tours from:

- Writing: https://www.flocrivello.com/flostate/?y
- Visual collecting: https://resurf.so
- Bookmarks/read-later: https://www.shiori.sh
- Secondary saved-item baseline: https://raindrop.io

Shiori here means shiori.sh, not the older go-shiori project.

Be ruthless about preserving their clean aesthetic and simplicity. They are the visual and interaction standard, not loose inspiration for decorating TextText's old components. Learn the hierarchy, density, typography, spacing, capture flow, content presentation, and restraint. Do not combine their feature lists or sidebars.

Take Flo State's immediate, concentrated writing experience; Resurf's image-first gallery and focused viewer; Shiori's short path from capture to useful reading. Raindrop supplies secondary organizational references, not another layer of controls.

For agent onboarding, inspect:
- https://docs.pencil.dev/getting-started/authentication
- https://paper.design/docs/mcp

Borrow the low-ceremony connection and immediate visible work. Distinguish an agent embedded in TextText from an external client operating TextText. Do not infer provider authorization or native packaging feasibility from another product's buttons.

Research should be bounded: a small representative set, not site mirrors or dozens of full-page screenshots. Record source URLs and concrete lessons in a short local note. Do not claim to have inspected inaccessible screens. Use original styling and assets; do not copy proprietary code or branding. Reference-product speed claims are not measurements of TextText.

### Visual rejection criteria

Reject a result that still looks like an admin dashboard with a nicer font. In particular:
- No duplicate navigation taxonomies or giant Home dashboard.
- No large card surrounding every text row, nested rounded containers, metadata badge walls, decorative AI glow, or oversized administrative headings.
- No three permanent rails merely because the existing components use them.
- No empty space or tiny low-contrast text presented as sophistication.
- No template/schema/provider vocabulary in the everyday content path.

Use neutral surfaces, readable text, restrained separators, consistent control sizes, and a subtle accent. Let images and content supply most of the color. Keep actual selection and keyboard focus clear. Preserve accessibility, touch access, contrast, IME, and reduced motion. Essential actions cannot be hover-only.

Use sentence case and direct labels. No em dashes in product copy.

## 3. Inspect current reality and establish a recoverable baseline

Read AGENTS.md, current handoff instructions, DESIGN.md, and the relevant workspace, template, collaboration, and agent documents. Inspect HEAD, git status, and focused diffs. Preserve unrelated work.

Historical context, not current proof:
- At d6137d75, a report described Home/capture/template improvements with passing focused tests but a failed real provider refinement, no verified agent-generated template save, and incomplete performance comparison.
- Subsequent reports described real-generation connection checks, request preservation, and a sandboxed runtime probe that reached authorization start but not an authenticated edit.
- Reports distinguished the installed native build, current source, deployed web code, and Store/standalone runtime availability.

Recheck those facts. Do not undo newer fixes or keep declaring an old problem present after it has been repaired. A commit, a web deployment, and an installed native application are different artifacts.

Locate the actual code for:
- Shell, Home, folders, Command-K, capture, reader/editor, visual assets, and view restoration.
- TextPack document/template definitions, rendering, safe interactions, revisions, and fallback.
- Human presence, live editing, comments, sharing, audit, and conflict handling.
- Agent setup/status, provider adapters, native controller, shared tools, preview/save paths, and edition capability checks.
- Existing performance fixtures and end-to-end tests.

Useful starting points, only where they still exist:
`src/components/workspace/ItemTypeStudio.tsx`,
`src/app/api/ai/item-type/route.ts`,
`src/lib/ai/provider-model.server.ts`,
`src/lib/ai/workspace-ai-config.server.ts`,
`docs/agent-interoperability.md`, and
`docs/agentic-assistant-runbook.md`.

Use bounded searches and focused ranges, not full repository dumps. Record a concise implementation map and the first runnable test.

Update obsolete design instructions that still prescribe duplicated Writing/Bookmarks destinations, Continue plus a duplicate timeline, Everything/Writing/Saved/News dashboards, or mandatory three-column layouts. This brief governs presentation; existing data, authorization, collaboration, and recovery contracts remain binding. Old component arrangements are not compatibility requirements.

Before substantial edits, save this brief and the recovery checkpoint as specified in section 12. Then implement.

## 4. One quiet shell and one command surface

Reopen where the person left off: a note, a folder, a reader, or a viewer. A fresh workspace can show a simple library and one obvious creation action. Do not force an onboarding dashboard on every launch.

Primary navigation:
- Search/command with Command-K.
- All items or an equivalent useful library entry.
- The actual folder hierarchy, shown once.

Names such as Notes, Reading, Visuals, and Projects are examples, not mandatory app categories. Folders can contain mixed content. Do not place a second Collections hierarchy below hardcoded copies of those destinations.

Make unread, starred, content-type, and date filters contextual. Keep genuine Shared with me access, Trash, settings, help, and recovery discoverable without turning each into a product. Preserve RSS source/subscription semantics; incoming feed entries do not automatically become deliberate permanent saves.

Shared folders appear in the normal tree with restrained sharing indicators. There is no separate collaboration dashboard.

Use a compact header around the current location, the relevant creation action, participants, Share, and secondary actions. Do not permanently display global search, capture, and chat inputs as competing fields. Command-K finds material and actions; direct editor/viewer controls remain available. Command-first does not mean text-only.

The sidebar can collapse and remembers the person's choice. The agent surface opens on demand and does not reserve empty space. Do not reimplement the existing assistant merely to change where it is presented.

Remove default repetition: Continue entries repeated in the main list, large Home category sections, permanent activity calendar, and New type/Blueprint/Look studio controls. Keep advanced functionality reachable contextually.

Use desktop width for libraries and galleries; keep a comfortable reading measure for documents. Preserve scroll, selection, focus, and location on open/back/close. Make shortcut help searchable or contextual. Single-key shortcuts must never intercept normal editor typing.

## 5. Three excellent default experiences

### Writing

Open a note directly into usable editable content. Title and body are primary. New note immediately focuses writing; no compulsory title, schema, or Edit/Preview/Save sequence.

Use the existing editor's best supported live Markdown behavior. Formatting controls appear where relevant. Properties, tags, timestamps, and publication metadata are secondary, not a form above every document.

Preserve multiline paste, IME, text selection, undo, autosave, local/draft recovery, and real collaboration. Typing must not wait for a network round trip or an agent.

Preserve explicit publishing for eligible writing. A new item, template choice, or folder move must not silently publish it. Do not create a separate blog editor for the same document.

### Visuals

Make the image the gallery item. Use consistent small gutters, useful intrinsic proportions, and stable previews. Do not crop all portraits, screenshots, posters, and images into identical squares or require metadata footers on every asset.

Opening an asset gives it a large viewer. Zoom, source, original dimensions, caption, and comments remain accessible without permanent inspector furniture. Long screenshots need an intentional preview and access to the full original.

Folder-level drag/drop or paste creates visual items promptly. Preserve original media and animation. Use suitable thumbnails; do not download and decode every original just to display the gallery.

Use still previews for GIFs in large collections and deliberate animation on interaction/opening. Respect reduced motion and stop animation when it is no longer visible.

Mixed folders use meaningful previews for notes, links, and visuals. A single storage model does not require one generic rectangle for everything.

### Bookmarks and read-later

A standalone URL in capture immediately creates one saved Link item in the current folder. Metadata, image, readable content, and archive/enrichment work happen afterward through the existing pipeline.

No AI, type chooser, mandatory title, or successful extraction is required to save. Pending/failed extraction remains a useful link with an actionable status. Retry without duplicating the item. Do not overwrite manual edits made while enrichment was running.

A bookmark and its captured article are one item. Open the clean article when available; otherwise retain useful link access. Make title, source, body, and Open original primary. Highlights, personal notes, capture details, and summaries are contextual. Do not place an AI summary above every article by default.

Captured source, user-authored commentary, and generated material remain distinguishable. Refreshing a source cannot erase the person's work. Captured website scripts are not trusted application code.

### Contextual creation rules

- Plain text creates a note.
- Prose containing a URL remains prose.
- A standalone URL in folder capture creates a link.
- Images dropped into a folder create visual items.
- Images pasted into a note editor insert into that note.

Use one familiar creation mechanism with clear context. Save input before asynchronous work. Acknowledge local pending capture honestly; do not claim a durable server save before it exists. Keep interrupted captures recoverable through existing storage.

Folder defaults guide presentation, not forced content conversion. Preserve item identity during moves and warn/confirm where inherited access changes.

## 6. Flexible templates without template administration

Default note, gallery, and reader experiences must already meet the reference standard. AI customization is for personalizing or extending good defaults, not repairing mediocre ones.

A template is a way of working with material, not just a theme. It can provide supported document layouts, excerpt/commentary arrangements, folder tables/contact sheets, revealable sections, and controls backed by real content state.

Use a contextual Customize action for the current item or folder, available through Command-K and a restrained menu. Do not make people begin with New type or a schema designer.

Examples to implement using the actual current capabilities:
- “Put my commentary beside this article and keep the source visible.”
- “Make this visual folder a contact sheet. Show captions when I select an image.”
- “Show these references as a table with the source, my verdict, and the limitations I recorded.”

Do not invent missing facts to fill a view. Changing presentation is not authorization to summarize, rewrite, alter access, or publish.

### The working loop

1. Start from real selected content and its current template.
2. Preserve the target, version, prompt, and requested scope.
3. Let the existing agent change the actual supported TextPack definition.
4. Validate and render a usable preview against that content.
5. Accept a follow-up and refine the same design.
6. Keep or cancel, with comparison and revision recovery.
7. Save through normal permission/conflict checks and read back the result.

Use the same authoring representation and APIs for humans and agents. Do not substitute static HTML, screenshots, prose, a canned starter, or a mock provider response for the actual generated result.

Preserve original Markdown, metadata, assets, unknown fields, and editing. Template controls write through existing APIs, not a hidden parallel state store. Keep a safe standard reading/editing fallback if the template fails or is removed.

Applying to the current item, choosing a personal folder view, changing future folder defaults, and changing a shared template are different scopes. Use the narrowest scope that actually matches the request, explain wider effects, and do not silently migrate existing items. Reuse can be an explicit subsequent action, not an initial wall of configuration.

First prove a research reader with persistent commentary and cited excerpts, then a visual/reference folder view. Do not add hardcoded Research or Reference sections to navigation.

## 7. Multiplayer is a first-class quality requirement

Do not obtain minimalism by removing or hiding collaboration. The product is not three solitary utilities bundled together.

Put a small participant group and discoverable Share action beside the current folder or item. Clearly distinguish private and shared work. Avoid a permanent activity feed when live changes and contextual history communicate more directly.

Human collaboration must remain real:
- Authorized people see edits and additions without manual reload.
- Preserve selections/cursors, contextual comments, attribution, and live editing where supported.
- Folder updates are narrow and do not reorder the item under the pointer or destroy keyboard selection/reading position. Offer a restrained new-items affordance when needed.
- Permissions apply identically through standard and custom templates.

Agents participate in the same material and collaboration presentation:
- Distinguish a person from an agent and identify whose agent it is, for example “Codex · working for [name]”.
- Derive active presence and progress from actual runs/events, with expiry. A configured account is not an active collaborator.
- Agent results belong in the authorized item or an explicit preview, not only in a detached chat transcript.
- Shared results do not mean shared provider credentials, private prompts, or unrelated conversation history.
- Another collaborator cannot implicitly command or spend someone else's account-backed agent.
- Reuse identity, audit, permissions, and presence. A self-declared label is not an independently revocable security principal.

Personal view preferences stay personal unless explicitly shared. Shared template/content changes are revisioned. Reverting an agent edit must not erase newer human edits; use existing live-edit and conflict mechanisms rather than blind whole-document replacement.

Distinguish Stop working, remove an actual document grant, and disconnect an account. Expose only revocation/isolation the implementation truly enforces. Do not imply an item-only security scope if a runtime retains unrestricted workspace or shell access.

Verify with separate authenticated sessions and actual mutations. Decorative avatars and simulated presence do not establish multiplayer.

## 8. Add agent: bring my existing agent into this document

This is the primary agent promise:

> I already use an agent. Let me bring it into this material and work with it here, without becoming the integration engineer.

Design one small task-centered flow, not a connection-settings product. Preserve the distinction between using an agent inside TextText and exposing TextText to an external agent. The latter remains available but is not a substitute for the former.

### Entry and first use

Add agent sits beside participants. Command-K, asking for a change, and Customize reach the same setup controller when needed. Do not maintain separate configuration paths for ordinary assistant work and template work.

A compact sheet communicates:

    Add your agent
    Work together on [current item].

    [Supported agent]
    [Honest account/billing description]
    Connect

    Other connection methods

Show only methods that genuinely work in the running edition. Start with one dependable account-backed path rather than a wall of provider logos. If the selected runtime already has a valid, appropriately authorized account, offer to use it without unnecessary reauthentication.

Use the provider-supported authorization flow and return automatically to the same item. A required provider consent or device-code step is legitimate; a copied workspace token, terminal command, edited configuration file, or instruction pasted into another client must not be the normal in-app flow.

The person must not have to choose native/cloud, inbound/outbound MCP, transport, or credential storage before working.

Show the authorized target and access succinctly, such as “[Item] · Read and edit”, but only when that description matches enforced capabilities. Account authorization is reusable; item access is a separate decision. Connecting an account must not silently grant the whole workspace.

If a prompt already exists, preserve and continue it after setup within its authorization. If setup was opened without a task, return to a focused composer. Do not create a surprise demonstration document or silently edit existing content as a setup test.

### Supported authentication, not fabricated parity

Consult current official documentation and the actual bundled runtime version before implementation:
- Codex App Server: https://developers.openai.com/codex/app-server/
- Anthropic Agent SDK: https://code.claude.com/docs/en/agent-sdk/overview
- Apple sandboxing: https://developer.apple.com/documentation/security/app-sandbox

Checked design basis as of September 27, 2026: Codex App Server documents managed ChatGPT sign-in, token persistence, and refresh. Anthropic's Agent SDK guidance says third-party Claude account login/subscription limits require prior approval. Reverify both before shipping. Sources are the official pages above, not another application's UI.

Prefer the existing Codex App Server integration as the first account-backed candidate where supported. Label it honestly: Codex using a ChatGPT account, not imported ChatGPT conversations, memories, or unrestricted API access. Use documented credential ownership; do not scrape another application's secrets or invent OAuth flows.

Do not advertise Claude subscription login without a verified supported arrangement. Existing Claude API-key access can remain clearly labeled as separately billed, and external-client support remains distinct. Do not drop a working supported provider merely to simplify the screen.

API keys belong under an advanced alternative, not as an equally prominent engineer-oriented first-use requirement. Repair that path where needed, but do not call it completion of the existing-account goal. A hosted default assistant changes cost/billing and needs an explicit owner decision.

### Intended-edition feasibility is an early gate

Identify the intended shipping edition and actual running build. Do not silently change the owner's Store/TestFlight distribution decision to make an unrestricted runtime test pass.

Historical source reportedly disabled or omitted the native account-backed runtime in Store packaging. A later helper probe reached authorization start, not a verified edit. Reinspect current code and receipts before treating that as still true.

Perform a bounded feasibility test of the existing supported runtime/helper under the real sandbox, signing, packaging, and tool-access constraints. Launching a helper or displaying sign-in is not success. Verify an authorized request and actual TextText tool use. Keep a test build isolated from the owner's installed app.

If blocked, record the exact technical or provider restriction, the proof, and the smallest decision needed. Continue independent UX work, but do not disguise the blocker with an API-key-only fallback or external-client instructions. No sandbox bypass or speculative claim of App Store approval.

MCP and WebMCP expose application capabilities to a host agent; they do not by themselves make that agent run inside native TextText. Preserve existing integrations. Do not expand them into the critical path or force the user into another app to satisfy this acceptance test.

## 9. A verified connection must lead to verified work

Reuse current real-generation checks, draft preservation, model selection, native fencing, and improved errors if already implemented. Do not recreate their older broken versions based on historical reports.

Maintain understandable states such as Not set up, Authorizing, Checking, Ready, Working, and Needs attention. They can be internal states with quiet contextual presentation, not another dashboard.

A stored key or successful model-metadata lookup is not proof of generation or tool readiness. Validate through a small real request at setup/recovery or the user's first requested preview. Distinguish authenticated, tools available for this target, and actively working. Do not run paid health checks continuously or on every launch.

Account configuration belongs to the supported owner/account scope, not every document. Keep document tasks and conversations isolated; reusing a runtime must not leak one item's context into another. Do not spawn a resident process, duplicate transcript, or unconditional model session for every open item.

Preserve prompt, selected item/folder IDs, template/document base versions, scope, and pending task identity across setup, reconnect, and navigation through existing draft/session storage. Re-read changed material before applying a result. Account/workspace changes invalidate stale callbacks; merely switching tabs cannot retarget work.

### Error and recovery behavior

Classify based on actual evidence:
- Rejected/expired credentials: reconnect and resume the preserved task.
- Unavailable model or denied access: explain what configuration needs correction.
- Quota/billing limit: identify the limitation rather than repeatedly retrying.
- Rate limit or temporary network problem: a safe, bounded retry path.
- Missing runtime or unsupported edition: explain before offering misleading setup.
- Invalid template: feed useful validation errors into the existing bounded repair loop.
- Version conflict: reread/reconcile; never silently overwrite.
- Unknown failure: say it is unknown, preserve the draft, provide a diagnostic identifier.

Carry a redacted correlation ID across the relevant UI/native/server stages. Keep useful diagnostic detail behind disclosure and full logs in appropriate local/server storage. Do not log credentials or whole private content unnecessarily.

Cancel stops further work where supported and prevents late results from applying. Reconnecting does not replay completed writes. Check ambiguous outcomes using existing receipts/idempotency before offering retry.

### Work on real TextPacks

The same selected connection must handle ordinary item work and customization. Prove both a real content edit and a template refinement; a successful JSON generation alone is not the full agent experience.

Give the existing agent the exact selected material, current definition, supported operations, and relevant renderer feedback, not an indiscriminate workspace dump. Source documents, imported content, tool responses, and shared text are data, not new trusted instructions.

Preview through the actual renderer. If the representation cannot express a request, identify that capability limit rather than blaming authentication or executing arbitrary privileged code. Use existing tools and versioned save paths. Verify authoritative save/read-back and reopening before claiming completion.

Do not add a separate planner/critic/verification-agent stack. Improve the current bounded loop.

## 10. Performance is part of the product design

Measure the existing production-mode baseline on a named reference machine and dataset before significant changes. Record hardware, OS, edition, native/web revisions, cold/warm conditions, and measurement method. No comparison of a debug development build to a production competitor as if the engines alone explain the difference.

Initial engineering targets, not claims of achieved speed:

| Interaction | Target |
| --- | --- |
| Typing, including concurrent collaboration | Input-to-visible-update p95 under 50 ms |
| Warm Command-K | Focused and usable within 100 ms |
| Cached folder/item navigation | Useful content visible at p95 within 100 ms |
| Capture | Immediate local acknowledgement, no dependency on extraction or inference |
| Idle/repeated open-close cycles | No unnecessary agent work or sustained unexplained memory growth |

Measure cold launch separately and set a documented improvement target from the baseline. Do not invent a memory ceiling from Flo State's different workload. Report actual whole-app process-tree memory, idle CPU, and growth across repeated operations. Report misses, not just averages.

Protect the hot paths:
- Writing updates locally without waiting for network, AI, indexing, or broad workspace rerendering.
- Reuse existing metadata/cache facilities rather than parsing every full TextPack to draw a folder.
- Virtualize or incrementally render large lists where supported; decode suitably sized visible media and release resources on close.
- Apply narrow human/agent updates and keep the interface responsive during generation.
- Bound caches, logs, transcript retention in memory, event queues, and subscriptions. Clean up listeners/streams and avoid duplicate reconnect loops.
- Saved templates render without inference. Lazy-load unused tools and authoring UI.

Test a substantial mixed library, visual-heavy folder, long document, and two collaborators with a real agent operation. Do not meet the targets by removing collaboration or using empty fixtures. Fix a broken benchmark fixture if it prevents measurement; “benchmark could not start” is not a performance pass.

Profile before changing the editor or desktop engine. Do not begin an unapproved native rewrite merely because a reference uses one.

## 11. Keep the coding session from becoming a memory problem

This requirement is separate from TextText performance. The host ChatGPT/Claude application or session may crash or exhaust RAM. You cannot guarantee control of its memory from repository code. Minimize controllable workload/transcript growth and make progress recoverable on disk.

Use one primary coding session, one necessary dev server, and one browser automation instance by default. No parallel agent swarm. Use additional authenticated contexts only for a bounded multiplayer test and close task-owned extras afterward. Keep a native test runtime only while needed.

Run builds, broad tests, and heavy browser/native checks sequentially. Do not leave duplicate servers, watch-mode suites, or retrying runtimes running. Use targeted tests while iterating and broader gates at checkpoints. Bound durations and retries. Do not respond to growth simply by increasing heap limits.

Keep outputs small:
- Put long logs in ignored local files; report exit code, a short relevant excerpt, and the path.
- Do not dump entire trees, dependency files, large fixtures/JSON, base64 screenshots, or repeated whole diffs into chat.
- Read focused code ranges and summarize once.
- Use selective, moderately sized screenshots, normally no more than two per review batch. Save other visual evidence to disk.
- Do not repeatedly paste this brief, full plans, or long progress transcripts into the conversation.

Check available memory and task process-tree usage before expensive work and at phase boundaries with existing system tools. Set practical workload bounds for the actual machine; do not add a permanent monitoring service.

At sustained pressure or continuing unexplained growth: stop launching work, update the checkpoint, and gracefully stop only known task-owned redundant processes. Verify identity/start information before using a recorded PID after a restart. Resume with a smaller batch or stop at a recoverable boundary.

Never kill ChatGPT/Claude, the user's installed TextText, their browser sessions, or unrelated Node processes. No broad kill commands. Do not claim a host-client leak is diagnosed or fixed without evidence.

## 12. Durable checkpoint and fresh-session recovery

Before substantial work, save this entire brief in the repository, preferably at:
`docs/design/texttext-content-first-ux.md`

Maintain one compact canonical checkpoint, preferably:
`docs/TEXTTEXT_UX_CHECKPOINT.md`

Use existing equivalent canonical paths if present. Merge the new brief carefully and reconcile existing completed work. Do not create another competing roadmap or overwrite unrelated requirements. Add a short pointer in the main handoff.

Update the checkpoint before editing, after each coherent verified slice, before expensive checks, about every 10–15 minutes during prolonged work, and before stopping. Use atomic replacement where practical. Keep it current and concise, not append-only history.

It must record:
- Goal/non-goals, brief path, accepted decisions, and unresolved owner decisions.
- HEAD/branch, actual worktree status, current phase, and completed/pending work.
- Changed files and pre-existing unrelated dirty files to preserve.
- Exact next action and runnable command where relevant.
- Tests and visual checks, pass/fail/unverified, and the exact build/revision/edition/provider exercised.
- Current blocker with redacted log/screenshot paths.
- Task-owned process commands, PIDs, ports, start/identity information, and cleanup needs.
- Commit, install, deploy, or release actions actually taken; do not imply actions from plans.

Do not place secrets, sign-in codes, raw provider payloads, or unnecessary private content in the checkpoint. Keep code saved in small coherent slices. Follow repository commit policy; do not auto-stash/reset/clean or overwrite unrelated changes to create a tidy checkpoint.

### Instructions for a fresh session after a crash

Read repository instructions, the canonical brief, and the checkpoint. Inspect git status and focused diffs before editing; reconcile them because the previous checkpoint might predate an interrupted write. Check recorded processes before starting new ones. Revalidate only affected or stale results. Briefly state the current stage and next action, then continue there. Do not restart reference research, redo completed features, or rerun every expensive test by default.

The repository must contain enough information to resume without this chat or any unsaved client memory.

## 13. Delivery sequence and evidence gates

Keep this one project delivered in small sequential slices. Do not use the number of sections in this brief as a reason to create that many subsystems.

### Slice A: establish facts and unblock the critical path

Inspect current code/builds, reference screens, baseline performance, and existing checkpoint. Update conflicting design guidance. Reproduce any remaining agent failure and test the supported account-backed path in the intended edition early. Record exact blockers without stalling independent work indefinitely.

### Slice B: the common shell and three reference-quality screens

Implement the quiet folder-based shell, a writing document, a visual folder/viewer, and a saved article using real varied content. Include compact human/agent collaboration affordances immediately. Compare actual renders with the references before propagating the design. Retain existing storage and behavior.

### Slice C: daily use and genuine multiplayer

Finish contextual capture, immediate editing, reader/viewer navigation, background enrichment states, stable folder updates, comments, and real shared edits. Preserve publishing, feeds, sharing, and recovery through uncluttered access.

### Slice D: connect and work, then customize

Complete Add agent in the supported target edition. Resume a preserved task after authorization. Prove a real scoped content edit and research-reader template preview, refinement, save, and read-back. Keep the same connection and collaboration machinery. Prove a second folder presentation without duplicating data or implementing another builder.

### Slice E: durability, performance, and cleanup

Verify reference fidelity, permissions, collaboration, real-agent behavior, error recovery, and measured performance. Remove obsolete presentation only after its necessary behavior is preserved. Verify the checkpoint is sufficient for a fresh session.

### Acceptance: minimum proof, not checkbox theatre

Demonstrate these coherent journeys and failure cases:

**Daily content**
- Create and type a note immediately without AI or a title form.
- Prose containing a URL stays a note; a standalone capture URL becomes one saved link before enrichment finishes.
- Drop images/GIFs into a mixed folder, then open/close a large viewer without losing place or accumulating resources.
- Open a captured article; read and annotate the same item with the source retained. Failed extraction remains usable and retry does not duplicate.
- Navigate an unduplicated folder tree with Command-K, keyboard controls, and correct narrow-screen behavior.

**Shared work**
- Two authenticated sessions show real concurrent note edits, folder additions, and comments without reload or disruptive jumps.
- Read-only users cannot mutate via custom controls or agent entry points.
- Personal view changes do not silently alter shared templates.
- A real agent run is scoped and attributed; another collaborator cannot command the owner's account by virtue of presence.
- Human changes made during an agent operation survive its completion, cancellation, and conflict/revert handling.

**Add agent and customization**
- Start disconnected in the intended native edition, request Customize, authorize through its supported UI, and return to the exact preserved request.
- No terminal, pasted workspace bearer token, configuration editing, or external-client handoff is needed in the primary path. Required provider consent remains visible.
- Agent makes a real content edit and a real template preview. Refine, keep, read back, reopen, and confirm content/annotations and a reusable connection.
- Verify expired/rejected authentication, unavailable model, temporary failure, quota/rate limit where testable, canceled setup, late callbacks, and workspace/target changes with honest classification. Do not deliberately incur uncontrolled costs to test limits.
- No developer credential override or unrestricted helper secretly supplies a capability unavailable in the tested shipping edition.
- Invalid templates retain the last working state; fallback reading/editing and revisions preserve all content.

**Quality and recovery**
- Inspect actual rendered note, gallery, reader, Add agent, and active shared-edit screens. Test light/dark, normal/narrow widths, keyboard focus, and reduced motion.
- Record timings and memory for realistic workloads including collaboration and active agent work. Repair test prerequisites rather than report a skipped benchmark as success.
- Reconcile a checkpoint with the worktree as a fresh session would; avoid duplicate processes and repeat effects. Do not intentionally crash the user's client to prove this.

Automated tests and builds are necessary but not sufficient. Label mocked/manual/live-provider and web/native tests accurately. A prepared preview is not a save; provider configuration is not active presence; a compiled helper is not a completed editing session; screenshots are not proof of live collaboration.

## 14. Authorization and final handoff

Do not push, deploy, publish a release, submit to an app store, replace the owner's installed app, change distribution, purchase services, or alter billing without separate explicit authorization. Use isolated test builds and fixtures. Stop for unavoidable owner-only authorization rather than bypassing it. Do not ask for permission to do ordinary non-destructive implementation work already covered by this brief.

Keep the final report compact:
- What changed and which existing systems were reused.
- The supported agent path and concrete edition limitations.
- Visual evidence paths and actually executed tests.
- Measured performance/memory, including misses.
- Remaining blockers and the exact next action.
- Brief/checkpoint locations and task-owned processes still running.

Update current documentation to match verified behavior; do not leave old and new claims contradicting each other.

The product standard is:

> As focused to write in as Flo State, as content-led for visuals as Resurf, as direct to save and read in as Shiori, and genuinely multiplayer with people and their agents.

The first-use agent standard is:

> Ask for a change. Add your agent if needed. Authorize. Return to the same material. See the work. Keep it.

The implementation standard is:

> Reuse the primitives, replace the cluttered presentation, finish the real interaction, and leave every slice measured, saved, and recoverable.

Begin with bounded repository/reference inspection and the checkpoint. Then implement.
