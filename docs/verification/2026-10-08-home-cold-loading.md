# Cold home preview loading

Mixed-library Cards/List now show static title/excerpt placeholders while the
first preview is pending, instead of presenting filenames and generic reading
instructions as saved content. Existing saved labels still display on return
navigation. Empty saved titles display Untitled. Pending files remain keyboard
accessible through an explicit file-path label and advertise aria-busy.

Preview failure ends the pending state and leaves the original file accessible
with Preview unavailable copy. A known cached saved title is preserved. A refreshed
listing retries the preview normally; no extra requests, document loading in the
listing, animation or persistent cache were added.

Rebuilt offline browser checks passed both Cards and List pending states,
missing-file preview failure, restored-file refresh recovery, saved-title remount
and unchanged-path external-edit invalidation. Light/dark Cards and List screenshots
were inspected. TypeScript passed. Logs:
`/tmp/texttext-home-loading-{build,browser,return,types}.log`.
Screenshots: `/tmp/texttext-home-loading-{light,dark,list-light,list-dark}.png`.

Source acceptance only; installed Mac 1207 and Oracle do not include this follow-up.
Cold loading duration has not been improved or measured by this presentation fix.
