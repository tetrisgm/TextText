# Agent file backend

Hosted MCP, authenticated CLI commands and in-app workspace tools use the same file-backed executor. Missing storage configuration fails closed. No public executor falls back to SQL content. Account and authorization metadata remain in SQL.

The current canonical catalog is defined in `src/lib/mcp/vault-contract.ts`. It exposes workspace/folder discovery, item listing/reading/search, create/update/append, file move/delete/restore and Trash listing, and comment listing/replies/resolution. Existing-item changes use full-document Yjs and the sync engine's durable command receipts; retrying the same append key after a lost acknowledgement does not append twice. Live account/grant checks run before content return and under the mutation commit lock. Agent presence is attributed and removed when the command finishes.

## Remaining parity

This is an intermediate backend, not completion of all agent functionality. These former SQL tools currently return explicit unsupported errors rather than touching an independent content store:

- Navigation and research: `review_brief_sources`, `open_item`, `list_reading_sources`, `search_reading`, `keep_item`, `add_feed`, `hide_summary`, `set_reading_preference`, `clear_reading_preferences`, `run_command`.
- Templates: `remix_item_type`, `create_item_type`, `update_item_type`, `save_item_as_look`, `set_folder_template`, `retire_document_template`.
- History, publication and organization: `list_agent_changes`, `revert_agent_change`, `set_item_status`, `organize_items`, `delete_items`, `empty_trash`.
- Assets and discussion: `add_item_asset`, `remove_item_asset`, `recapture_bookmark`, `list_responses`.
- Folders and sharing: `create_folder`, `rename_folder`, `move_folder`, `delete_folder`, `restore_folder`, `list_access`, `set_access`, `revoke_access`.

The narrowed schema also identifies the supported fields on implemented commands. Adding an operation requires the file store/audit boundary, current grant checks, concurrency and retry tests, then a catalog change. SQL-only fixtures are not evidence of file-backend parity.

## Regression evidence

`src/lib/mcp/__tests__/vault-tools.test.ts` covers authoritative identity, item scopes, current file grants, shared search, revision-consistent previews and actual public dispatch. `vault-mutations.test.ts` uses temporary real file workspaces to test public append, lost acknowledgements, operation-key reuse, revoked replay, competing replacements and opaque asset preservation. `vault-agent-presence.test.ts` covers live agent lifecycle and expiry. The sync subsystem's collaboration suite remains the underlying concurrency gate.

Native command responses preserve the shipped Swift decoding contract: item
identity/title/hash, top-level Markdown, capture destination receipt, and search
results with kind/status/folder. The mandatory native route regression compiles
and decodes its actual responses with the production Swift structs on macOS.
Responses expose the actual canonical `path`. Native remote CLI create, capture
and search use that validated relative path (`89aa390c`), with compatibility
fallback only when an older server omits it. Absolute paths, traversal and
malformed paths are rejected. Twenty-two focused Swift tests passed.

File move/delete require the original path and hash plus a stable idempotency key. Moves retain the filename and require edit access to both source and destination folder. Deletion retains a recovery copy. Trash lists current tombstones; restore keeps the item identity while creating a new archive generation and collaboration epoch, privately. Item-scoped editing tokens do not gain organization authority.
Organization commands currently report the durable result without transient typing presence, so replay after deletion does not require reopening a deleted collaboration session. Text and comment edits retain agent presence. Restore requires the tombstone path/hash and stable operation key; a different destination folder can resolve occupied paths.

Restore safety uses a reserved `texttext-lifecycle.json` archive entry plus its server lifecycle record. Pre-restore uploads become durable conflicts before history reconciliation; they cannot revive an old generation. Shared archive encoding preserves the marker, as do native copy-and-replace ZIP writers. Independent copied identities can carry the opaque entry without inheriting another item's server lifecycle. Retrying a completed restore does not roll back later edits. Publication markers are removed on restore.

Template listing reads built-ins and authorized `Templates/*.textpack` definitions. Applying a template requires the target hash and stable idempotency key; custom definitions additionally pin the source file identity/hash. The engine changes only presentation in the existing full-document Yjs session, preserves opaque entries, and rechecks target/source access under commit. Collaboration carries the validated definition in its durable journal so native checkpoints and offline reopening retain custom looks. Creating/remixing template definitions remains outside the hosted tool catalog.
