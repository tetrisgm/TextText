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

Limits: source corrections still need installed acceptance; the live test above
uses a source-less definition and does not certify model-generated blueprint
updates or Windows installed behavior. It does not certify reference-service
fidelity or all sync failure modes.
