# Default-off PC native measurement host adapter

Source-only follow-up to [measurement preapply supervision](2026-10-19-measurement-supervision-preapply.md). New `sync/stress/measurement-host-pc.mjs` implements an explicitly invoked, Windows-host **pc-app ownership inspect** adapter. No coordinator/launcher activation, sampler start, actor, task or normal-app launch occurs. No campaign or physical T24 evidence is claimed.

## Authority and bounds

Disabled mode returns before filesystem access or commands. Enabled mode requires a separately caller-pinned `trusted-pc-launch-owner-v1` record: exact role/run/source/generation/session/task, independently captured runtime tuple and executable hash, plus exact PowerShell/task/helper/config/module/executable bytes. The record must come from the genuine launch owner; actor stdout, actor PID claims and existing bootstrap receipts do not create this authority. No existing launcher emits this new sidechannel yet, so production authority remains unavailable until reviewed additive launcher integration.

A new create-only request invokes only existing `stress-native-task.ps1 -InspectOwnership -OwnershipRequest` with pinned config/module hashes. That script checks actual task action/lifetime, interactive runtime identity and unchanged inputs before/after collection. The adapter rechecks every captured launcher/input/request byte after the command, validates collector monotonic/wall brackets against fresh **same-host** time, then checks the actual returned receipt/runtime against the independently pinned launch tuple. `scopeClaimsVerified=false` is not promoted to provenance. Exact receipt/envelope bytes are captured once and preserved privately; Buffer bytes are explicitly copied into the strict Uint8Array DTO.

Collector execution uses direct spawn arguments, no shell, a 10-second command deadline and 64KiB combined output limit. On deadline/output overflow, only the newly spawned readonly collector handle receives a termination request. The callback resolves boundedly with partial output and metadata; actual child exit/cleanup is **unproven** on that path and is not a finite-lifetime guarantee. No actor/browser/task signal API exists. Successful inspect freshness is tighter: at most five seconds local elapsed with bounded wall/monotonic disagreement. Failures preserve output evidence rather than reporting ownership success.

## Deliberately unavailable

Browser inspection is rejected before a command: its existing `OwnedTask` checks action/node identity but lacks exact lifetime/settings verification. Next step is a reviewed additive check in the genuine browser task owner before/after inspection, not a parallel PowerShell authority implementation. Mac/native browser and direct-file launcher provenance remain separate missing adapters. No guessed PIDs, private Playwright fields or SSH ancestry are used.

Sampler first-line readiness, full-series duration/count/due-time/phase coverage and final aggregation are **not implemented here**. Existing sampler `complete` summaries or validated prefixes do not prove complete campaign coverage. `coverageComplete`, logical counters, HTTP commits and render/paint evidence are not upgraded.

## Controlled verification

Mac pure Node gate: **84 passed, zero failed/skipped**: 34 new native adapter controls plus25 supervisor and25 ownership checks. Tests cover default-off, forged/missing/changed launcher/input/request, strict data fields, runtime reuse and scope drift, malformed/stale envelopes, clock/latency mismatch, create-only replay refusal, single-read envelope preservation and exact inspect arguments. Two actual disposable Node collector commands exercise deadline/partial-output and output-overflow paths; they are not PowerShell, actors or genuine PC ownership proof. Existing task source-contract assertions are not actual Windows execution.

Final log and before/after source guards: `/private/tmp/texttext-measurement-host-native-review-20261019/{test-final.log,source-final.before,source-final.after}`. Source guards match. Parent owns review/registration/commit. No existing launch/task/supervisor code changed and no secrets, account/profile configuration or user state were accessed.
