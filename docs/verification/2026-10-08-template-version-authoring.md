# Template source and immutable-version verification

## Actual installed-client acceptance

Mac 0.204 (1215), existing iCloud workspace. The installed CLI created
version 2 of `local.2cf77b78-905b-46b6-b4db-85f17e104a90` using
`update_item_type`, the exact version-1 source hash and a stable retry key.

- Independent ZIP/hash inspection confirmed the version-1 library package
  remained byte-for-byte unchanged.
- Existing `Notes/Untitled 9.textpack` remained pinned to version 1.
- The Mac's New from template picker offered the version-2 name.
- Choosing it created `Notes/Untitled 12.textpack` with the version-2
  definition and Findings/Questions/Sources/Next steps starter.
- Naming and saving through the real editor persisted
  `Template version 2 creation verification 1216`; ZIP inspection confirmed
  the title and version reference.
- A fresh-process retry returned the identical new file identity and revision.

Evidence: `/tmp/texttext-template-version-1216-{before,result,list,retry}.json`.
An additional real `create_item_type` / blueprint `update_item_type` round trip
created an authored template and its separate version 2. Independent local
ZIP inspection confirmed the updated name/starter and `template-source.json`;
the original authored package remained byte-identical. Evidence:
`/tmp/texttext-authored-template-1216-{create,update}.json`.
The temporary empty note created while locating New from template was retained.
No existing content was removed.

## Source correction

The earlier native refinement preview omitted `templateAuthoringSourceJSON`.
`prepareTemplateProposal` treated omission as removal, so keeping it discarded
the previous blueprint. The source and its saved library copy consequently
lack that ZIP entry. This corrects the scope of the earlier
[reuse receipt](2026-10-08-native-template-library-1215.md): reuse passed;
retained editable provenance was not proven.

The shared preview now preserves compatible omitted source and refuses
incompatible omission before any write. Explicit definition replacement can
remove obsolete source. Persisted creation/update/apply previews now carry
their matching blueprint metadata; manual folder-definition edits explicitly
replace obsolete provenance.

Targeted verification: 35 tests across preview, saved-look, folder-view and
workspace-template command suites. Log:
`/tmp/texttext-authoring-command-preview-regression.log`.

## Real model refinement and library reuse

Installed Mac 1216 created `Notes/Untitled 13.textpack` from the authored
version-2 look. Its saved title is Agent authored-source refinement verification
1216. The retained Codex connection produced a preview for a smaller title.
An initial inconsistent compiled design was refused without changing package
entries. A subsequent request produced a matching editable blueprint and
compiled design. Before accepting that preview, all ZIP entry bytes remained
unchanged despite package repacking.

Keep this design changed only `template.json` and `template-source.json`.
Writing and other entries remained unchanged. The blueprint records
`theme.titleScale: compact`, matching the compiled definition. The editor
automatically resumed after the shared update.

Actual Save as look created
`Templates/Agent refined reusable blueprint verification 1216.textpack` with
the matching editable source retained. The picker offered that look, and
choosing it created `Notes/Untitled 14.textpack` with the same template identity,
compact title theme, blueprint and Findings/Questions/Next steps starter.
Independent ZIP inspection verified both files.

After the Oracle authoring deployment, a newly opened real Safari tab loaded
the new item's canonical shared URL and showed the retained custom look and
Mac presence. Saving its title as Refined blueprint web reuse verification
1216 automatically updated the open Mac editor. Independent local ZIP inspection
confirmed the title, unchanged starter body and retained compact-title blueprint.

Evidence: `/tmp/texttext-authored-refinement-1216-{before,preview,kept}.json`,
`/tmp/texttext-authored-refinement-1216-before-entries.json` and
`/tmp/texttext-refined-library-1216.json`.

Limits: these checks certify this real model workflow on installed Mac 1216.
Windows installed behavior, reference-service fidelity and all sync failure
modes remain separate acceptance work.
