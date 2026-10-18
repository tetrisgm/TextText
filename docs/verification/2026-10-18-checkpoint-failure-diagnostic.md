# Bounded checkpoint failure diagnostic

Source verification only. This does not diagnose or repair the installed 1265 blank-note failure, change save/reopen behavior, or claim physical acceptance.

## Evidence and change

Installed evidence under `/private/tmp/texttext-mac-1265-installed-20261018` showed a clean generation-one native checkpoint and byte-identical captured projection. Its Yjs update, presentation, epoch/sequence and path matched the generation-two browser recovery export. The only journal changes were generation, edit permission and the generic retirement message. The original checkpoint rejection was absent from that export.

The shared client now captures a detached diagnostic before generic checkpoint retirement. The existing recovery download adds optional top-level `checkpointFailure`; `document`, `journal` and `rawJournal` are unchanged. The diagnostic is held in memory for this client lifetime, not written into the journal or native state. After restart, an unavailable original cause is represented by `null` rather than reconstructed.

The diagnostic contains version, allowlisted original code, exact allowlisted fixed product message, and scalar checkpoint context: generation, epoch, sequence, pending count, batch/unqueued flags and whether the failure was clean. Unknown messages become `Details withheld.` Unknown codes become `unknown`, or a valid bounded HTTP failure status. Error stacks, arbitrary text, paths, requests, account identities and credentials are never copied into this diagnostic. Sanitization reads only own data properties, never exception getters or stringification. This limit concerns the new diagnostic; it does not redefine the existing recovery document/journal export.

## Verification

- Final focused Vitest: **109 tests in two files passed**, zero skips/failures. Log: `/private/tmp/texttext-checkpoint-diagnostic-registration-20261018.log`. The earlier 108-test pass is preserved at `/private/tmp/texttext-checkpoint-diagnostic-focused-20261018.log`.
- `tsc --noEmit --incremental false` passed with no diagnostics. Log: `/private/tmp/texttext-checkpoint-diagnostic-tsc-20261018.log`.
- The integration fixture records a clean checkpoint callback rejection, then verifies that the original sanitized cause survives the later generic retirement and generation increment. Save failure and editing fences remain unchanged; no remote push occurs.
- Pure tests cover arbitrary-message redaction, unknown codes, accessor getters/stringification not being invoked, thrown Proxy reflection traps being contained, invalid numeric context, fixed shape and detached/immutable output. Reflection can invoke Proxy traps; the sanitizer does not claim otherwise.
- A source-level registration test checks that the existing recovery download adds only the safe diagnostic getter alongside its original three fields. This is not browser/download execution evidence.
- The recovery-download hunk was added after the title-focus worker released ownership. Browser/download execution and the broader source gate remain separate pending checks.

Files: [diagnostic sanitizer](../../src/sync/engine/checkpoint-diagnostic.ts), [sanitizer tests](../../src/sync/engine/checkpoint-diagnostic.test.ts), [shared client](../../src/sync/engine/client.ts), [client tests](../../src/local-vault/collaboration-client.test.ts), [existing recovery download](../../src/local-vault/CollaborativeVaultEditor.tsx).
