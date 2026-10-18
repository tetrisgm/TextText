# Agent built-in kind compatibility

A real production-handler regression reproduced both failures: canonical `gallery`/`talk` were refused by the public input schema, while advertised legacy `media_post`/`video_post` passed the schema but failed the file mutation handler. Four new cases failed and 18 existing mutation tests passed in `/private/tmp/texttext-t20-kind-red.log`.

The input schema now advertises canonical article/gallery/talk/note/bookmark, retaining documented legacy aliases. Structured legacy kinds normalize to canonical gallery/talk before template selection. Documents remain validated schema-v1 snapshots; no content types were introduced. Existing read-summary output remains unchanged. The retained legacy post adapter maps canonical input back to its existing storage enum.

Four real file-engine cases cover both canonical names and both aliases: create with the canonical built-in template, read, byte-identical idempotent retry, alias-to-canonical retry with the same operation identity, hash-guarded edit preserving the template, and revoked replay refusal. Permission callbacks and durable operation identity construction are unchanged.

Verification: final focused production handler/schema/template/read-adapter tests passed; TypeScript `tsc --noEmit` passed. Logs: `/private/tmp/texttext-t20-kind-checkpoint.log`, `/private/tmp/texttext-t20-kind-tsc-final.log`. This source checkpoint is not a deployment or completion claim for all five live CLI template acceptance cases; those must be rerun on the coherent installed candidate.

## Partial live CLI acceptance before deployment

The separate verified CLI from `93aa90ae` used the existing authenticated account against Oracle `316901bf`. In dedicated folder `Template acceptance 20261018 fa692167`, article `c46c22e7-53b4-4cce-8ca1-2ba7fa042557`, note `98623499-944e-4013-84ae-f1b9f6745c3c`, and bookmark `f6a95d4a-09d1-4e56-888f-6d0376b4a565` each passed create, exact create retry, read, hash-guarded edit, exact edit retry, and final independent read. The final snapshots retained schema 1, their canonical built-in template, draft visibility and empty assets; the appended verification text appeared exactly once. The Note used current built-in template version 2. These were new acceptance fixtures, not existing user documents.

The advertised legacy gallery kind `media_post` was rejected as unsupported before creation; talk was not attempted. Preserve and retry the original gallery request/key after the source fix is deployed, then finish talk and the wider template/UI/assistant/MCP acceptance. No five-template completion, asset roundtrip, editor-presence or separately queried audit-row claim follows from these three cases. Private requests/results and a hash-indexed `partial-receipt.json` are retained in `/private/tmp/texttext-t20-cli-20261018-cp0a6q1j`. The source fix is `5d88b1cc`; installed/served artifacts remain unchanged.
