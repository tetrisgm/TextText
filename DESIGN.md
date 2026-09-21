# TextText: personal workspace

## Current direction: September 21

The [personal workspace plan](docs/plans/personal-workspace.md) is the current
implementation contract. It supersedes the news-only composition below, which
describes the previous release. Artifact remains the editorial reference for
browsing; Shiori informs saved reading, nested collections inform organization,
and a clean article editor supports writing. Superhuman informs responsiveness
and keyboard efficiency, not the Home layout.

Home combines quick capture, a compact Continue section, and a dated personal
timeline. News is the full RSS destination. Bookmarks contains deliberate saves.
Writing contains notes and articles. Folders can mix these and custom types.
Desktop keeps resizable navigation on the left and contextual AI on the right;
explicit collapse choices are respected. Narrow layouts use accessible drawers.
All views share typography, colors, focus behavior and document identity.

The existing performance and visual verification requirements below still apply.

## Previous release reference

Artifact News is the visual and interaction reference for the app, including
Home, navigation, reading, writing, saved items and settings. The owner's
September 19 direction replaces the former broadsheet, Apple Notes and
Superhuman mixture. TextText's capabilities fit within this design.

## Reference

Original captures live in `~/Downloads/artifact-reference/`. The captioned
local gallery is `~/Downloads/ARTIFACT_VISUAL_REFERENCES_RECOVERED/artifact_screens_local.html`.
Use the actual light and dark screens when judging a change. The historical
feature mapping is in [the Artifact plan](docs/plans/artifact-home-replication.md).
Its clauses retaining the Apple shell and a segmented desktop bar are superseded.

## Composition

Home, Headlines and Profile retain Artifact's house, globe and person in
the bottom bar. Notes adds a fourth destination in the same bar, with its
own folder strip, note list and New Note action. A single news column is
centered at up to 640px on desktop and fills the phone. Search and the bell
sit above the horizontally scrolling topic strip. For You comes first.

The Home feed begins immediately. It has no greeting, Recent column, library
controls, folder tree or assistant panel around it. Profile contains Read
Later, Reading History, interests, hidden publishers, Publisher Subscriptions,
the library and settings. First-time news setup asks for interests.
Folders and the assistant are opened deliberately. Keyboard commands remain
available. The source catalogue makes an empty workspace a news setup state.

Opening a news article replaces the destination bar with back, share, Read
Later and Aa. The title belongs to the article. Aa holds text size and article
options. Writing uses the same column, sans serif type and neutral surface.
Documents keep their content and collaboration behavior across these changes.

## Type and surfaces

Use the system sans serif stack throughout the app. Compact headlines are
17.5px semibold with approximately 1.3 line height. Publisher labels are 15px;
metadata is 14px. Topic tabs use the headline size. Selection is ink and
weight, with no pill or underline.

Light uses white with near-black text. Dark uses `#000000` with `#f2f2f2`
text. Secondary text is `#6b6b6b` in light and `#9a9a9a` in dark. Shared
workspace colors live in `src/styles/artifact.css`; Home uses those same
tokens. Check text contrast against both the canvas and secondary surfaces.

Rows form one continuous list with inset hairline separators. Use about 14px
vertical padding, a 16px publisher mark, and a 68 to 72px square thumbnail.
Every few rows, a photograph occupies the column at 16:9. Photos have 8px
corners. Story rows have no card boundary, shadow or colored background.

Contextual actions open a bottom sheet, with large circular icons for
Show fewer, Read Later, Share and Hide publisher. Long press opens the same
sheet on touch screens. Feedback leaves a dimmed row
in place with Undo so the content below does not jump. Headlines groups
coverage from actual sources; displayed counts and reading times must be real.

## Verification

Inspect the running app beside the originals at phone and desktop widths,
in both themes. Check Home, Headlines, Profile, a saved article, the reader,
an editor and settings, including navigation back to the feed. A stylesheet
assertion alone does not establish visual fidelity. Keep accessible names,
visible keyboard focus and reduced-motion support.

Production benchmarks must keep article, feed, channel, folder and note
navigation below 200ms at the 95th percentile. Check New Note through saving,
reload and reopening. Check two editors typing at once, including intact
words and convergence; fast navigation cannot compensate for lost writing.

No em dashes in product copy. Use sentence case, direct labels and no
exclamation marks. Decorative marks must not carry information alone.
