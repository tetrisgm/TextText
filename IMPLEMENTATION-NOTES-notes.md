# Notes editor formatting

## Toolbar

- Added `src/components/BodyEditorToolbar.tsx`.
- The toolbar exposes Title, Heading, Body, bold, italic, strikethrough, bulleted list, numbered list, checklist, link, and the existing image insert action.
- Title maps to markdown `#`, Heading maps to `##`, and Body maps back to a paragraph. Existing `###` content is still accepted by the editor schema so older bodies are not dropped on load.
- Buttons use TipTap commands directly, so StarterKit keyboard shortcuts such as Cmd+B continue to work.

## Checklists

- `BodyEditor` now registers `@tiptap/extension-task-list` and `@tiptap/extension-task-item` alongside StarterKit, Image, Link, Placeholder, Markdown, and Collaboration.
- Task items use the standard `taskList` and `taskItem` node names. `tiptap-markdown` already provides markdown specs for those names, so checked state serializes to `- [x]` and unchecked state serializes to `- [ ]`.
- Markdown parsing is handled by the same `Markdown` extension already used for stored bodies. Its task-list parser converts `- [ ]` and `- [x]` into task item nodes before TipTap loads the document.
- The collaboration binding stays intact: the Y.Doc is still created before editor initialization, StarterKit history is disabled only for collaborative sessions, and `Collaboration.configure({ document: ydoc })` is still appended after the markdown-capable schema nodes exist.

## Light and dark styling

- Toolbar and checklist styles live in `src/styles/apple.css` under the `.applecms` scope.
- New colors are derived from existing Apple editor tokens that already define light and dark values.
- Accent text uses `color-mix(in srgb, var(--ac-accent) 60%, var(--ac-label))` to keep the 60 percent ink contrast floor. Decorative fills and native checkbox accenting use the existing tint tokens.
- Motion is limited to short hover color transitions, with a reduced-motion override.

## Verification

- `npx tsc --noEmit` passes.
