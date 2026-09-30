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
The existing Codex account connected and a two-column commentary/excerpt proposal
was requested. Real provider preview/refine/keep/reopen is not yet verified.

Folder presentation scopes, Command-K Customize, full prompt history recovery,
and the rest of the product brief remain open. No public release or push.
