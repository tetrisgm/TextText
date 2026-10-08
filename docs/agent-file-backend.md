# Agent file backend

Hosted MCP, authenticated CLI commands and in-app workspace tools use the same file-backed executor. Missing storage configuration fails closed. No public executor falls back to SQL content. Account and authorization metadata remain in SQL.

The current canonical catalog is defined in `src/lib/mcp/vault-contract.ts`. It exposes workspace/folder discovery, item listing/reading/search, create/update/append, file move/delete/restore and Trash listing, and comment listing/replies/resolution. Existing-item changes use full-document Yjs and the sync engine's durable command receipts; retrying the same append key after a lost acknowledgement does not append twice. Live account/grant checks run before content return and under the mutation commit lock. Agent presence is attributed and removed when the command finishes.

## Remaining parity

This is an intermediate backend, not completion of all agent functionality. These former SQL tools currently return explicit unsupported errors rather than touching an independent content store:

- Navigation and research: `review_brief_sources`, `open_item`, `list_reading_sources`, `search_reading`, `keep_item`, `add_feed`, `hide_summary`, `set_reading_preference`, `clear_reading_preferences`, `run_command`.
- History, publication and organization: `list_agent_changes`, `revert_agent_change`, `set_item_status`, `organize_items`, `delete_items`, `empty_trash`.
- Assets and discussion: `recapture_bookmark`, `list_responses`.
- Folders and sharing: `rename_folder`, `move_folder`, `delete_folder`, `restore_folder`, `list_access`, `set_access`, `revoke_access`.

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

Template listing reads built-ins and authorized `Templates/*.textpack` definitions. Applying a template requires the target hash and stable idempotency key; custom definitions additionally pin the source file identity/hash. The engine changes only presentation in the existing full-document Yjs session, preserves opaque entries, and rechecks target/source access under commit. Collaboration carries the validated definition in its durable journal so native checkpoints and offline reopening retain custom looks. `create_item_type` saves a validated blueprint and compiled definition into a new Templates TextPack; `save_item_as_look` captures the source presentation and theme with a pinned file hash, without copying private writing or attachments. Both require template-library edit access and a stable operation key. Completed retries return the same artifact after later source edits, while new saves refuse stale source hashes. Neither changes existing items or folder defaults. `remix_item_type` copies an exact built-in version or hash-pinned accessible template into a new identity at version 1. It retains validated fields, layouts, theme and starter content without source writing or assets. Authored copies retain their editable blueprint; generated description/example labels follow the new name. Source-less and built-in definitions are otherwise copied exactly. Fresh library/source access and durable retry rules are the same as template creation.

Approval recovery persists a server-generated command key with immutable arguments before execution. Only versioned canonical commands can resume an already-approved operation; pending/denied and older unversioned proposals never auto-execute. Concurrent recovery reuses the engine receipt and SQL completion only transitions the matching executing proposal. After expiry, recovery validates the exact command fingerprint and current authority in receipt-only mode; it never starts a new write. Missing receipts return expired. Adapter/receipt transport failures remain uncertain and retryable with the same proposal ID, because a file commit may already be durable.

`create_folder` creates one filesystem directory under an existing parent (empty `parent_path` means workspace root). It requires a stable idempotency key, fresh parent editing authority, and the shared durable journal/audit receipt. Replaying a completed operation never recreates a subsequently removed directory. Folder metadata, rename and deletion remain outside the catalog.

`update_item_type` requires the source file identity/hash and base version from the template list. It creates a separate Templates TextPack with the same validated template ID and the next version, preserving the prior definition and every document pinned to it. Authored types retain their validated editable blueprint; source-less looks accept compatible render-data definitions. Incompatible stored fields and automatic application requests are refused. The artifact identity is derived from workspace/template/version, so competing updates cannot overwrite or create two definitions for the same next version. Both source editing and library editing authority are rechecked for new writes and completed receipt replay.

`create_item` accepts `template_id` and an optional pinned `template_version`. Creation selects the latest accessible valid artifact under the workspace write lock and seeds explicit starter content, never preview examples. Supplied title/body override defaults; supplied field keys override starter keys. The selected definition is embedded in the new TextPack. Durable retries retain the original bytes and source identity even after newer versions appear, and recheck source and destination authority. Invalid unrelated artifacts are skipped; duplicate selected versions fail closed.

### Account workspace discovery

`GET /api/vault/workspaces` accepts a browser session or an existing native app
bearer with `sync` scope. Manual/OAuth agent tokens and item-scoped tokens cannot
use this account surface. It returns `defaultWorkspaceId` and authorized
`{id, name, access}` summaries for the owned default, full workspace memberships
and explicit file/folder invitations, with fresh authorization and no file paths
or credentials. Membership email matching uses the stored account identity.

Both native adapters expose `workspacesList` and `workspaceOpen({workspaceId})`.
Selection is separate from account credentials. Opening validates current access
and the portable folder binding, prepares the replacement, and flushes pending
edits before retiring the current view. Collaboration, agent and watcher
lifetimes are replaced together. Scoped replicas preserve files omitted from
filtered manifests and retain unauthorized pending writes without immediate
retry loops. Last-known permissions allow offline local editing; uploads require
a fresh manifest. Permission-only updates must refresh the listing even when
no file is downloaded. The shared account menu also exposes this discovery on
web. See `docs/HANDOFF.md` for installed versions and live acceptance limits.

`set_folder_template` pins a validated item default in the folder’s marked TextPack definition, separate from its collection layout. It requires the current definition hash (null for create-only), exact template version, stable key and current folder editing permission; custom sources also pin identity/hash. Generic UI and agent creation use its starter only for omitted content, while explicit template/kind/capture choices win. Existing items retain their embedded looks. Multiple definitions, occupied paths, stale sources and retired template identities fail without creating a new item. Template-based UI creation imports one complete TextPack, so there is no intermediate blank file.

## Template retirement

`retire_document_template` writes a validated, ordinary TextPack record under the canonical `Templates/Retired/` directory. It retires an entire custom template identity from future selection, creation and version updates; existing documents retain their embedded template. Explicit remixing creates a different identity. Deliberately deleting the retirement record makes the original identity available again. Replaying the old retirement command cannot recreate a deleted record.

Retirement requires the exact source item and hash, current source/destination permissions and a stable idempotency key. In-app proposals freeze the source title and revision and require approval. Expired proposals may recover a completed receipt but cannot make a new change. `vault-template-retirement.test.ts`, the public template adapter tests and proposal lifecycle tests cover these boundaries, including raw file additions/removals without a prior manifest request. The library rejects ambiguous duplicate versions rather than choosing by file name.

Folder-default discovery scans all immediate TextPack siblings without a 2,048-item or aggregate archive-size ceiling. Server and Windows caches retain only metadata/negative results, keyed by current native fingerprint or content hash; file changes and renames invalidate them. Discovery retains the supported 64 MiB individual-pack bound, 4 MiB expanded metadata/response bounds, and 16 recognized-definition bound. Oversized or ambiguous settings fail explicitly rather than silently choosing another definition.

`update_item.fields` edits declared fields on the current embedded template using per-key Yjs mutations; null clears one field. The engine validates changed values under the commit lock and rejects undeclared/reserved metadata keys. Unrelated fields and document content are preserved. Public adapter and approval lifecycle tests cover stale hashes, replay, invalid values, clearing and current access after expiry.

### Local CLI proposals

`texttext commands` separates directly callable `commands` from `proposals`. A full workspace connection can use `texttext propose <name> --args ...` for supported durable file writes. This persists an owner review link and executes nothing until explicit approval. Item-scoped and read-only tokens cannot stage workspace proposals; upload-time revocation and owner binding are checked again. The direct CLI denial list remains unchanged. Local PostgreSQL regression `agent-cli-proposal.db.test.ts` verifies persisted review metadata and an untouched temporary vault.

`add_item_asset` attaches one validated public image as cover, body image or gallery asset. It requires the current file hash and a stable idempotency key. Bounded preparation runs outside the workspace lock; access and hash are checked again before a single durable intent saves the original, preview, asset mapping and Yjs document references. Completed retries and expired receipt-only recovery never fetch again. Existing opaque entries and collaboration epochs survive. Open-world cloud-tool restrictions remain in force; this does not add unconfirmed URL fetching to the web assistant. Video importing remains separate follow-up work.

`remove_item_asset` detaches one exact asset ID with the current file hash and stable operation key. Approval freezes the asset label/source and target revision. Detachment removes actual Markdown image/link references (preserving code and link labels), matching cover/image fields and the asset entry in one Yjs intent; opaque/archive media bytes remain recoverable. Missing assets, stale hashes and revoked access fail without mutation; completed retries work after the reference is gone.
