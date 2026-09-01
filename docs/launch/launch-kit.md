# TextText launch kit

This is the single source of truth for a Hacker News and Product Hunt launch.
Keep the product claim narrow, show the real workflow, and link to evidence.

## Product claim

TextText is a fast document inbox for people and their AI tools.

Save a thought, link, meeting note, or useful AI answer in one motion. TextText
keeps it as a durable document that you and any compatible, authorized AI can
find, change, and share.

The five-word version is: **Save anything. Bring your AI.**

## What to demonstrate

Use one continuous recording. Do not tour settings or narrate architecture.

1. Capture two rough notes and one link from Library without leaving the page.
2. Ask the in-app assistant to turn them into a concise launch brief.
3. Open the created document from the assistant receipt.
4. Select one paragraph and ask for a shorter version.
5. Apply the exact preview, then use Undo.
6. Ask a connected Codex or Claude agent to find the brief and append one
   guarded paragraph.
7. Return to TextText and show the attributed change in the same document.

Target length: 45 to 60 seconds. Show the pointer, typed prompt, visible result,
and Undo. Remove account names and private content before recording.

## Hacker News

### Title

Show HN: TextText, a fast document inbox that your AI tools can use

### First comment

I built TextText because useful writing was getting stranded between notes
apps and AI chats. I wanted one place where I could capture a thought or link
quickly, then let the AI tools I already use find and change the same durable
documents.

The core loop is capture, retrieve, change visibly, and recover. TextText has
an in-app assistant, a signed-in local connection for supported Codex and
Claude agents on Mac, and a scoped hosted MCP endpoint for compatible remote
clients. They all use the same document model and guarded command surface.
Deleting moves items to Trash. Private notes and bookmarks remain unlisted.
Mutations are revision-checked, attributed, and audited.

The Mac app is a signed and notarized Apple silicon build. The web app,
documentation, download, and source are public:

- Product: https://texttext.app
- Download: https://texttext.app/download
- Documentation: https://texttext.app/docs
- Source: https://github.com/tetrisgm/TextText

I would especially value feedback on the capture flow, whether agent changes
are legible enough, and which AI client you would most want tested next.

## Product Hunt

### Name

TextText

### Tagline

The fast document inbox for you and your AI

### Description

Capture thoughts, links, notes, and useful AI answers without leaving your
inbox. Then use TextText's assistant, Codex, Claude, or another authorized MCP
client to find and change the same durable documents. Every agent works through
guarded commands with visible receipts, attribution, conflict checks, and
reversible Trash.

### Maker comment

I made TextText because AI tools are good at producing and reshaping text, but
their useful work often disappears into chat history. TextText makes the
document the result.

The app is built around one short loop: capture something quickly, retrieve it
from the AI you already use, make the change visible in the document, and keep
a clear recovery path. It includes a Mac app, in-app AI, local Codex and Claude
connections, hosted MCP access, collaboration, reusable item types, and
portable textpack export.

This release is for Apple silicon Macs. I would love feedback on whether the
first useful result arrives quickly enough and whether the agent's work feels
as concrete and inspectable as editing the document yourself.

### Suggested gallery order

1. Library with the capture field and Open or Undo receipt.
2. Assistant creating a named document from selected source items.
3. Document with a targeted rewrite preview and Apply or Undo controls.
4. Settings showing connected AI providers and clients with Disconnect.
5. Finder or Share menu showing the native Mac integration.

Use 16:10 images at one consistent window size. Keep private data out of every
frame. The first image must communicate capture plus AI without explanatory
copy.

## Public FAQ

### Is TextText a notes app?

It can replace a simple notes app, but its focus is durable text shared between
people and authorized AI tools. Notes, bookmarks, articles, briefs, projects,
and custom item types use one document model.

### Does TextText train on my writing?

TextText does not train a model on workspace content. When you connect an AI
provider, requests are sent according to that provider's terms. Private items
remain access checked and unlisted.

### Which AI tools work with it?

The Mac app supports an in-app provider connection and signed-in local Codex
and Claude integrations. Compatible remote clients can use the authenticated
hosted MCP endpoint. The connection documentation names the limits of each
path.

### Can an agent delete everything?

Ordinary deletion moves items to Trash and can be restored. Empty Trash is a
separate, explicit owner-confirmed operation. There is no arbitrary unbounded
batch command.

### Is it open source?

The source is public for inspection and contribution. No software license has
been granted yet, so reuse rights should not be assumed.

### What platforms are supported?

The current direct-download app supports Apple silicon Macs. The web app is
available at texttext.app. Windows, Linux, iPhone, and iPad apps are not part
of this release.

## Launch links and release facts

- Site: https://texttext.app
- Documentation: https://texttext.app/docs
- Download: https://texttext.app/download
- GitHub: https://github.com/tetrisgm/TextText
- Release: https://github.com/tetrisgm/TextText/releases/tag/v0.182
- Version: 0.182
- Build: 1002
- Architecture: arm64
- SHA-256: `c3d83a911d7e6310fcb39c5c5c1dca1be156d57c0b1d7a48982b595803681ba2`

## Go or no-go

Launch only when every item below is true on the public production build.

- Landing, sign-in, documentation, download, appcast, and version endpoints
  return the expected production release.
- The downloaded app passes Gatekeeper, signature validation, and stapled
  notarization validation.
- A clean account can sign in, capture, connect an AI, create a document,
  target an edit, and recover it without a terminal.
- A supported external agent can find and change the same test document with a
  visible receipt and attribution.
- The 45 to 60 second demo uses the released build and contains no private
  content.
- Product Hunt images are legible at thumbnail size.
- Hacker News and Product Hunt copy make no unsupported platform, privacy,
  semantic-search, autonomous-agent, or universal-client claim.
- One person is available to watch errors, answer comments, and pause the
  launch if sign-in, AI, or download health regresses.

### Current readiness, 2026-09-01

Engineering and distribution are ready: the public site, documentation,
download, appcast, GitHub release, signed and notarized Mac build, production
onboarding route, authenticated editor, agent integrations, 21-case live
workflow suite, and launch-critical dependency patches are deployed and
verified. Exact evidence and deployment identifiers live in `docs/HANDOFF.md`.

Do not post the launch yet. The owner must complete the three visible checks
that cannot be truthfully generated from an unconnected production workspace:

1. Connect the production workspace to the AI provider intended for the demo.
2. Record the continuous 45 to 60 second workflow above with disposable,
   non-private content, then export the five 16:10 gallery frames from that
   same real run.
3. Perform one final launch-day sign-in and AI run, then remain available to
   watch errors and answer launch comments.

Choosing a source license is an independent owner decision. It does not block a
source-visible launch because the FAQ already states that reuse rights are not
granted, but it should be decided before describing TextText as open source.

## Deliberately not claimed

- No TestFlight or App Store release yet.
- No Windows, Linux, iPhone, or iPad app yet.
- No Slack, Drive, Jira, GitHub, mail, or calendar connector gallery.
- No semantic embedding index or cross-service search.
- No autonomous scheduled agents or general Plan mode.
- No arbitrary unbounded batch operation.
- No guarantee that every MCP client implements the same authorization flow.
