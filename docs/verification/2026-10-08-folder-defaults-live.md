# Folder default live acceptance, 2026-10-08

Oracle source `5254ff85`, installed Mac/CLI 1190. Executed with the installed `texttext` command and existing account; no credential handling. Only a new verification folder and new template/items were changed.

## Passed

- Created `Template verification 1190`.
- Remixed built-in note into `local.3c1b183a-d37a-46d7-8807-58e8e80fbf5d`, then saved version 2 with starter body `Folder default verification 1190.`. Version-2 source: `942ea9f4-e982-4caa-8f6d-7cf432685018`.
- Pinned that exact version as the new folder's default. Folder view identity: `e66dd942-aed8-4e0b-8910-db0abc30ee41`.
- Generic creation produced `dd009497-291e-40e5-8b81-3b8927fd8bc0` at `Template verification 1190/Pinned default verification 1190-dd009497.textpack`, with the exact starter marker once. Identical request/key replay returned the identical full receipt.
- Explicit `kind: note` produced `6bd89a00-b9bb-425d-84a4-131f5669a328` without the custom starter.
- Installed CLI local listing/read observed the synchronized created files and original identity/marker.
- Reset only the verification folder default to built-in `texttext.note` version 1 using its fresh folder-view hash. The already-created custom item retained its unchanged canonical hash and marker. Reset revision: `01b943dc544f287213a6bdf41913a301536707f16890a5059de6d0c13fdd5455`.

## Remaining live check

`retire_document_template` correctly refuses direct local CLI execution under the existing approval policy (HTTP 400). No retirement occurred. The CLI advertises `propose`, but the command route currently refuses proposal mode, so owner-reviewed live retirement acceptance remains pending that connection. Do not weaken direct-command policy to bypass approval.

Transient command/response receipts: `/tmp/texttext1190-accept/`. Scripts: `/tmp/texttext1190-accept.py`, `/tmp/texttext1190-retire.py` (the latter stops at the refused retirement). These contain test identifiers and content, no credentials.
