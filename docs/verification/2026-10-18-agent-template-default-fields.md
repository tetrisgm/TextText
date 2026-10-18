# Advertised template default fields

Real file-handler tests reproduced rejection of public-schema-valid `update_item_type.save_scope:{mode:"version"}` and `set_folder_template.apply_to_existing:false`. The initial gate failed three assertions with 23 passing tests (`/private/tmp/texttext-t20-default-fields-red.log`).

The handlers now accept these two no-op defaults. Template version creation, folder default publication, permission callbacks, source/current-version checks and operation IDs are unchanged. Omitted versus explicit defaults replay the same durable result. Strict save-scope parsing refuses unknown shapes. Folder/usages application scopes and `apply_to_existing:true` are explicitly refused before writes; bulk migration was not implemented or implicitly approved.

Focused tests preserve immutable template v1 and existing pinned item bytes while creating v2, prove future generic creation inherits the folder default while explicit kinds retain their template, check stale writes and revoked replay, and require refused bulk folder changes to leave the folder empty. The intermediate green attempt exposed a fixture-only parsed-versus-raw blueprint default mismatch on retry; both retries now use the public parser, preserving production request normalization.

Final focused log: `/private/tmp/texttext-t20-default-fields-final.log`. TypeScript `tsc --noEmit` passed (`/private/tmp/texttext-t20-default-fields-tsc.log`). No live account mutation, installation or deployment occurred. Live candidate acceptance remains required.
