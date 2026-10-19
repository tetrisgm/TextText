# Shared folder dispatch policy

## Scope and preserved boundaries

`mirror-folder.ts` is the packaged owner of the migrated folder admission/dispatch disposition: `none`, `hold`, `stage-new`, or `replay-existing`. Strict observations contain only phase, capability/topology/contained-change flags and named native barriers; unknown fields/enums, duplicate/unknown barriers, sparse arrays, accessor slots and extra/symbol array properties refuse. Both adapters use the same32 serialized vectors. No native fallback implements the disposition.

Native adapters still discover actual directory changes and verify owner/root/account, advertised authoritative context, exact topology/tree/identity, wire bounds, durable profile and immutable command. They allocate/persist IDs, perform OS operations, validate authenticated receipts and adopt metadata. A policy result grants no filesystem, cancellation or journal-clear authority. Generic409/lost replies keep the original command; pending replay ignores fresh topology and the ambiguous `conflicted` flag.

Existing platform barriers are preserved explicitly rather than declared equivalent:

| Branch | Mac | Windows |
|---|---|---|
| New candidate | Affected document outbox, binary outbox, saved rename | Affected document outbox, binary outbox, raw/typed saved rename, pending pull |
| Existing command | Existing affected saved-rename preflight remains | Existing replay branch has no added work barrier |

The added host await checks captured memory and durable state before continuing; changed durable state aborts the pass without a stale final save. Mac rechecks native owner/binding, current folder context and actual changed identities/tree. Windows additionally captures exact owner bytes, current capability/revision/catalog, invokes existing scope callbacks around awaits and before staging, and rescans the actual tree. Existing mandatory native guards remain. No new durable schema, writer, general-folder automation, total-pass budget or permission relaxation was introduced.

## Verification

- **174 portable policy/host tests**, nine files, zero skips; **14 registration tests**, zero skips. The official client/native selections and packaged policy digest inputs include the new source/tests.
- TypeScript `--noEmit --incremental false`: exit0.
- Packaged Chromium: existing and32 new folder vectors, offline evaluation and old-page reload fencing pass.
- Final Mac focused gate: **21 tests, zero skips/failures**:13 folder-sync,2 strict policy,3 HTTP transport fixtures and3 policy-host tests. Actual WKWebView executes folder vectors in the existing visible/hidden-window contract. These controlled fixtures are not installed interaction proof.
- Actual PC: Core build passes; **370 focused assertions** pass:67 folder propagation,29 recovery,274 policy/shared-path. This is not a full-Core runtime or app-install claim. Core DLL SHA256 `76759c9a1219451e62c6b5ee8ee43eff50f350014447cf74adfef8e98a07cdb5`.
- Both native suites include an actual durable-state mutation during the policy await, checking refusal, zero folder dispatch and exact retained newer bytes. Existing lost-reply/same-ID, empty-descendant, independent-content and recovery cases remain green.

The PC old-adapter comparison fails the new dispatch-integration assertion because it never calls the new folder host method; it is evidence that the regression exercises this seam, **not a claim of a pre-existing data-loss bug**. The first PC attempt failed compilation in a new fixture that referenced an internal helper; the corrected fixture uses exact directory enumeration. Both failures are preserved under `/private/tmp/texttext-folder-policy-pc-2o_67xp3/`. The subsequent old-adapter RED and current-adapter GREEN logs and named input hashes are retained there.

Final Mac evidence: `/private/tmp/texttext-folder-policy-final-nhcbcjzb/`. All20 owned source hashes match before/after and current bytes. The exact pre-task owner Package.resolved bytes were retained/restored with SHA256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`. The earlier15-test focused pass remains separately preserved.

## Evidence hashes

- `/private/tmp/texttext-folder-policy-final-nhcbcjzb/result.json`: `18ce410e42ad413ea6b94dd84391da4a1865d7d1d575037ddd10e799ca3e22c8`
- `/private/tmp/texttext-folder-policy-final-nhcbcjzb/swift.log`: `3ee62a934251427506e4798a086cd8d16e76dbffb74cf3b6eee0249f1fb6efd6`
- `/private/tmp/texttext-folder-policy-final-nhcbcjzb/chromium.log`: `10d39973fb496430e8b011b9e53a066257d2916c93ee6c899f2ea982c0013d7b`
- `/private/tmp/texttext-folder-policy-final-nhcbcjzb/tsc.log`: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- `/private/tmp/texttext-folder-policy-pc-2o_67xp3/passed.json`: `ad1ff052c9decd52e0858815c0569dbe0e105823485c2fe05b77ccc06515a5c1`
- `/private/tmp/texttext-folder-policy-all-portable-20261019.log`: `71f1906fddbfee35b91b88be7b0ccfbaa0c1cf6b9206d6cd60bbb9fac03ea103`
- `/private/tmp/texttext-folder-policy-registration-20261019.log`: `d1147238afcfe1b38b42ed670f21cd97e4801a1641b458dda4b4df7acd1bc833`

## Limits

This is a future source slice after frozen a0413982 delivery inputs. It does not relabel the installed1270 app, current sealed actors or Oracle artifact, and changes none of them. No live account, workspace, installation, deployment or infrastructure mutation occurred. General folder moves retain explicit owner review. No physical all-six-client campaign, idle/request budget, soak, performance or complete T11 acceptance is claimed.
