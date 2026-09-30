# File-backed design preview

Build 0.202 (1128) is installed. Contextual Customize opens the existing native
assistant with the current file as a fixed target. Customization turns cannot
write or create files: they can read/search and propose a template for that target.
Proposals validate against the full declarative schema before rendering real
content, with embedded assets resolved using temporary object URLs.

Compare, refinement, Keep and Cancel use one pending proposal. The proposal,
target, baseline hash and latest request are retained locally for recovery.
Keep re-reads the file and uses the ordinary compare-and-swap write; stale files
remain unchanged. Markdown stays byte-identical, structured content and extension
fields remain intact, and native writes retain opaque pack entries and images.
The saved design is read back. Blob URLs are revoked when previews unmount.

## Evidence

- Three TypeScript tests cover preservation, stale/different files, unsupported
  layouts and mismatched authoring source: `/tmp/texttext-template-preview-tests.log`.
- Five Swift tests passed, including non-writing proposals, stale hashes,
  malformed input, cancellation and customization scope enforcement:
  `/tmp/texttext-template-preview-swift.log`.
- Offline browser UI fixture passed preview/compare/refine/keep/cancel and prior
  file/editor/conflict/capture/image scenarios. This fixture tests the UI state
  machine, not provider capability: `/tmp/texttext-template-preview-browser.log`.
- TypeScript and scoped ESLint passed. Light/dark layout inspection caught and
  fixed a collision with an existing template-card CSS class.
- Build/install logs: `/tmp/texttext-build-1128.log`, `/tmp/texttext-install-1128.log`.
  The bundled UI matched a fresh build from current sources byte-for-byte.

## Live check in progress

A disposable Bookmark clone was created in Reading using the installed picker:
`Reading/How Figma’s multiplayer technology works.textpack`. Existing source
excerpt and explicit personal notes are the research-reader input. Original
bytes are retained at `/tmp/texttext-customization-before.textpack`; SHA-256
`d2101a0d15b8975b85566af86a32d2936209514d66f760e81a565facf532305a`.
The existing Codex account connected and generated a valid two-column design
using the actual excerpt and commentary, with a source link. Native UI rendered
both columns; disk bytes remained identical to the baseline. A refinement asked
for 2:1 widths and labels. The provider invented unsupported `weight` and `text`
properties. Full frontend validation disabled Keep, preserving the file, but the
provider had already been told the proposal succeeded.

That gap is now fixed: native tool completion waits for a frontend validation
acknowledgment. Invalid designs return bounded schema feedback as tool failure,
so the provider can revise them. The last valid preview is retained. Pending
acknowledgments are bounded and cleared on stop/completion. Browser regression
now proves invalid proposals send failure feedback without replacing a valid
preview or changing the file. Swift, TypeScript and lint checks passed.
Logs: `/tmp/texttext-template-feedback-{browser,swift,tsc,eslint}.log`.

The invalid installed preview was cancelled. The disposable clone remains
unchanged from its baseline. Build 1129 with this correction is in progress
(`/tmp/texttext-build-1129.log`). Real provider refinement, Keep, reopening and
cleanup remain next; do not claim that journey complete yet.

Folder presentation scopes, Command-K Customize, full prompt history recovery,
and the rest of the product brief remain open. No public release or push.
