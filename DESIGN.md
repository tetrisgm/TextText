# TextText: personal workspace

The [personal workspace plan](docs/plans/personal-workspace.md) is the implementation
contract. This document describes the current direction, replacing the previous
news-only composition. Artifact informs editorial browsing, Shiori informs saved
reading, and nested collections organize the workspace. Superhuman informs speed
and keyboard efficiency. Writing should feel like a clean article editor.

## Desktop and narrow screens

Desktop has three regions: persistent folder navigation on the left, the active
workspace in the center, and contextual AI on the right. Rails are resizable and
collapsible; respect explicit choices and remember them. Reserve each rail's width
once. The center takes available space, with readable line lengths inside it.
Do not stretch a phone screen across a desktop or force desktop navigation into a
bottom bar. Narrow screens use accessible drawers and compact destinations.

## Destinations

Home opens with quick capture, up to three Continue entries, and a dated personal
timeline. Continue reflects deliberate opens, not autosaves. It belongs in the
center, never in a separate fixed column. The timeline combines writing, deliberate
saves, and bounded news groups, with Everything, Writing, Saved, and News filters.
New arrivals must not shift the viewport or keyboard selection.

News is the complete RSS experience. Use editorial rows with source, time, title,
and restrained imagery. Bookmarks contains deliberate saves, including retained
RSS items. Give saved sources readable previews and useful metadata. Read later
is a state on an item, not a duplicate item or another type.

Writing combines notes and articles. Capture stays lightweight; longer writing
uses the same document identity and a quiet editor. New items remain nonpublic.
Folders and subfolders can contain any mixture, including user-defined types.
Keep Starred, Shared, Trash, settings, and search reachable from the workspace.

A folder's view and its default type for new items are independent. Choosing a
default does not restyle old documents. The type library and designer form one
lifecycle: inspect, create, edit, copy, export/import, restore, and retire. Preserve
editable source alongside validated presentation. Existing documents keep their
pinned versions unless an explicit migration is requested.

## Typography and surfaces

Use shared tokens in `src/styles/artifact.css`, the system sans serif stack, and
neutral surfaces. Check light and dark contrast on both the canvas and secondary
surfaces. Editorial headlines are approximately 17.5px semibold at 1.3 line height;
publisher labels 15px and metadata 14px. Selection uses clear ink and weight.

Editorial lists use inset hairline separators, about 14px vertical padding, small
publisher marks, and 68 to 72px thumbnails. Occasional photographs can occupy a
row at 16:9 with 8px corners. Avoid shadows and colored containers around every
story. Saved-reading cards and custom collection layouts must still share the
workspace's typography, spacing, focus treatment, and colors.

Reader and editor use comfortable measures without oversized desktop controls.
Contextual actions stay near the active item, with accessible touch sheets where
appropriate. Preserve position when opening an item and returning to its list.

## Interaction and speed

Opening the app repeatedly must be cheap. Restore the current location; make Home,
search, new capture, navigation, and creation available from the keyboard. Save
input before extraction or AI work. Preserve IME composition, multiline input,
offline drafts, history, and full-document collaboration.

AI stays contextual and shows its scope: current item plus explicitly attached
sources. Keep conversations across navigation and retain review-before-apply.
Library and designer dialogs must have one active focus trap and return to the
place that opened them. Preview samples must be bounded and labeled honestly.

## Verification

Inspect the running production build at phone, laptop, and wide desktop sizes,
in both themes. Check Home, News, Bookmarks, Writing, mixed nested folders, reader,
editor, settings, and back navigation. DOM or stylesheet assertions alone do not
establish visual fidelity. Keep visible keyboard focus, accessible names, and
reduced-motion behavior. Reference captures remain in
`~/Downloads/artifact-reference/`; the captioned gallery is
`~/Downloads/ARTIFACT_VISUAL_REFERENCES_RECOVERED/artifact_screens_local.html`.

Production article, feed, channel, folder, and note navigation must remain below
200ms at the 95th percentile. Check realistic large folders, cold and warm opens,
capture through save/reload/reopen, long documents, and concurrent editors with
intact words and convergence. Fast navigation cannot compensate for lost writing.
Record receipts against the actual running build, not an older preview.

No em dashes in product copy. Use sentence case and direct labels. Decorative
marks must never be the only way information is conveyed.
