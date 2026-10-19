# Protected saved-rename value model

Both native models define the same version-one immutable request, account/workspace/server/root scope, captured baseline hash and file generation, pending/terminal-rejected/stopped phases, terminal receipt and chosen stopped paths. They validate proposed changes for the existing sync-state owner; they allocate no IDs, write no journal and perform no network or filesystem operation. They are not native eligibility fallbacks. The packaged shared policy remains the admission owner.

A stopped record requires a matching typed conflict receipt and known matching file generations. Peer text revisions are absent from stopped-path matching. Replacing a stopped operation requires exact prior record identity and an owner-supplied durable create-only archive proof before full-state commit. The existing archive helper's parent-directory durability must be completed by the future caller before claiming that proof.

Windows legacy normalization preserves captured request/hash/path/ID even when a later text acknowledgement advances the current baseline. Missing/changed generation retains the exact legacy operation for review; a conflict flag cannot fabricate a terminal receipt. No current-generation inference or clearing is allowed.

## Strict decode boundary

Both models reject unknown/duplicate fields, invalid Unicode, trailing commas, future phases/versions, bad paths/segments and inconsistent nested receipt scope. Map count is bounded to 1,000. Raw record/map/state inputs have bounded size, depth and token counts. Before integration, existing State loading must run the raw structural preflight and strict map decoder before its ordinary JSON decoder. Swift Codable alone cannot detect duplicate JSON keys; this preparation does not claim that existing State loading already enforces the new boundary.

## Verification

- Mac: 15 tests, no skips, exit zero. `/private/tmp/texttext-shared-rename-model-strict-final-20261019.log`; exact source manifest `/private/tmp/texttext-shared-rename-model-mac-final-source-20261019.json`.
- Portable C#: 104 checks, no skips, exit zero. `/private/tmp/texttext-protected-saved-model-strict-final-20261019.log`; exact manifest `/private/tmp/texttext-protected-saved-model-strict-final-source-20261019.json`, SHA256 `536ed5ef44957c0a341b0d3e9ea675bcf2bc36c099dace779ff92b75f7297fbd`.
- Both consume the same 32 structured, nine raw-record and two raw-map codec cases, plus 1,000/1,001 map limits and raw-state duplicate/Unicode checks.

No existing Sync integration, live format publication, installed app or owner content changed. Actual PC full integration and actionable recovery UI remain separate work.

## Receipt-identity correction after model preparation

Follow-up to `7f968c14`: a terminal-rejected to stopped transition now requires the exact existing terminal receipt, including its revision and path. A separately valid-shaped substituted receipt is refused before the state writer. The original preparation evidence above is retained.

- Mac: 16 tests, zero failures or skips, exit zero; `/private/tmp/texttext-shared-rename-model-receipt-identity-20261019.log`. New negative cases substitute the terminal revision or path; the unchanged receipt remains accepted.
- Portable C#: 106 checks, zero failures or skips, exit zero; `/private/tmp/texttext-protected-saved-model-receipt-guard-20261019.log`, SHA256 `e988286a24a1a0959d56c19bed6506f01a6782d6037b8051cafcf95c543ce1f5`. This retains the prior 104 checks and adds both substitution refusals.

This correction remains value-model validation. It does not establish integrated rename recovery, publish a profile, or change owner content.
