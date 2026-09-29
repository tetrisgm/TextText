# Narrow assistant layout verification

- Commit `ff643705` makes the assistant fill the window below 850 CSS pixels; the adjacent document layout resumes at 850px. The matching Library safe area and compact toolbar rules now apply only from 850 to 900px.
- In the local signed-in browser at 720x900 and 840x900, opening the assistant showed the full conversation, controls, and composer without a clipped document column. At 720px, the computed assistant bounds were 0-720px, `position: fixed`, and document scroll width equaled the viewport width. Closing it restored the full editable note and Saved status.
- At 850x900, the document and assistant were both visible; the document title, body, edit controls, and Saved status remained accessible. Document scroll width equaled viewport width. The 850px assistant column is narrow but its message and actions wrap within it.
- `simplification-contract.test.ts` passed 10 tests; touched test ESLint and `git diff --check` passed. This was browser layout evidence; the later Mac Library check is below.

## Library in the installed Mac app

In the installed local build 0.202 (1112), the three-pane All items view with
the assistant open cut off the right edge of list dates and the date filter.
The Library now sizes its toolbar and full-bleed rows from the middle pane.
At a 900 CSS-pixel browser viewport, the Library pane measured 677px; the
date control stayed inside it and the document had no horizontal overflow.
After reloading the installed app, the filters, complete date input, sort and
view controls, and full `SEP 29` row dates were visible in both dark and light
appearance. The date input accepted focus on its month segment, and Tab moved
focus to the day segment. Dark appearance was restored. This verifies the
observed narrow three-pane state, not the app's exact 720-point minimum or
reduced-motion behavior. The installed binary was not replaced for this CSS
change; it used the existing local development server. Ten focused
`simplification-contract` tests and `git diff --check` passed.

## Reader, gallery, and Add agent in the installed app

With the assistant open in dark appearance, the `Visual scale proof` gallery
opened an image item without clipping the image. The viewer showed its caption,
1600 × 900 dimensions, original link, Zoom, and Close. Zoom changed to Fit and
made the full-size image scrollable. The saved `Texttext AI setup guide` reader
showed its title, body, and source link beside the assistant in dark and light
appearance. The Add agent panel fit on screen in both appearances; in light,
its expanded connection controls remained visible, Close had a visible focus
ring, and Escape closed the panel. Dark appearance was restored.

The Command-K cross-folder route fix and reload proof are recorded separately
in [the route receipt](command-palette-route-2026-09-29.md). These observations
do not establish the exact native 720-point floor or reduced-motion behavior.
