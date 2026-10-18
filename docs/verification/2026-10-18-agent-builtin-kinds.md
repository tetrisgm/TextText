# Agent built-in kind compatibility

A real production-handler regression reproduced both failures: canonical `gallery`/`talk` were refused by the public input schema, while advertised legacy `media_post`/`video_post` passed the schema but failed the file mutation handler. Four new cases failed and 18 existing mutation tests passed in `/private/tmp/texttext-t20-kind-red.log`.

The input schema now advertises canonical article/gallery/talk/note/bookmark, retaining documented legacy aliases. Structured legacy kinds normalize to canonical gallery/talk before template selection. Documents remain validated schema-v1 snapshots; no content types were introduced. Existing read-summary output remains unchanged. The retained legacy post adapter maps canonical input back to its existing storage enum.

Four real file-engine cases cover both canonical names and both aliases: create with the canonical built-in template, read, byte-identical idempotent retry, alias-to-canonical retry with the same operation identity, hash-guarded edit preserving the template, and revoked replay refusal. Permission callbacks and durable operation identity construction are unchanged.

Verification: final focused production handler/schema/template/read-adapter tests passed; TypeScript `tsc --noEmit` passed. Logs: `/private/tmp/texttext-t20-kind-checkpoint.log`, `/private/tmp/texttext-t20-kind-tsc-final.log`. This source checkpoint is not a deployment or completion claim for all five live CLI template acceptance cases; those must be rerun on the coherent installed candidate.
