# Note parent-reference source

Source through `3c61ff36`; not installed yet.

The current Note TextPack is version 2 with an optional multiple document
reference field `parents`. Exact version 1 remains resolvable. Omitted-version
lookup retains its historical version-1 behavior; current creation selects the
active catalog version explicitly. Roundtrip tests retain parent IDs and existing
Note content/version.

Shared field editing uses searchable saved item titles and removal controls.
Both local and collaborative editors receive permission-filtered listing choices;
templates, duplicates, unindexed files and the current item are excluded. Missing
references retain their stored values and show `Unavailable item`.

Focused creation/reference/field tests passed. Integrated core gate passed with
an exact-source receipt: `/tmp/texttext-core-parent-editor.log`. Existing browser
template flow passed inline/full insertion, finish/reopen and light/dark modes:
`/tmp/texttext-note-template-current.log`.

Selected parents now open through the shared save-before-navigation operation,
resolve their current path by stable ID and verify the opened pack identity.
Missing references are non-clickable. Seven field/choice tests and TypeScript
passed; actual rendered navigation acceptance remains pending.

Pending: parent-specific rendered interaction acceptance, child navigation,
explicit existing-note upgrade, inline card integration, client install and
Oracle deployment. No hierarchy traversal or full Supernotes parity is claimed.
