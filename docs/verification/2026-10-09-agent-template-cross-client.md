# Agent-created template item across clients

October 9, Mac 0.204 build 1242, installed Windows source `06c3ad60`, and
Oracle web source `06c3ad60`. The signed-in local `texttext` command ran
`create_item` in the selected iCloud workspace with the built-in
`texttext.note` template version 2, an explicit title/body, Notes destination,
and idempotency key `agent-template-cross-client-20261009-a`. It returned item
`e3a7e84e-118c-41c9-867c-8acf269177e1` at
`Notes/Agent template cross-client check 1242-e3a7e84e.textpack`.

The TextPack contains `template.json` with `texttext.note` version 2. Repeating
the same command and key returned the same item ID and revision, without a
second file. The installed Windows workspace acquired the same relative file.
The signed-in production browser opened it with the intended saved title and
body; Mac app Search found the same item and its reader showed that title and
body. This is one built-in-template creation and cross-client visibility
check. It does not establish custom look authoring, every item template, or
the complete agent proposal and permission flow.
