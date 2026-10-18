# Physical runner preparation, October 18

This is source and simulated orchestration evidence. No physical campaign,
installed candidate, T21 completion or T22 matrix pass is claimed here.

## Stable observation gate

The coordinator previously accepted the first matching all-six observation.
The file and browser adapters settle locally, which cannot establish that the
six replicas remain equal after another replica's delayed save arrives.

Every mutation round now requires three consecutive all-six observations,
separated by 500 ms, with the same semantic hash. Every matching observation
must contain the exact cumulative operation set, each planned marker exactly
once, the original baseline, and the required asset hashes from both direct
file actors. A divergent observation resets the streak. Editor identity and
reload counts are checked on every observation, including divergent ones.
Duplicate operation IDs are rejected rather than silently deduplicated.
An equal final observation without the full streak fails `convergence-unstable`.
A missing participant still fails the existing bounded collection barrier.

An independent zero-round reopen also requires three observations of the
specified prior semantic hash, exact configured asset hashes and continuous
editors. The event stream records every accepted convergence/reopen sample;
plan and summary record `requiredConvergenceSamples: 3`. Existing adapter
protocols and native input operations are unchanged.

The orchestration faults cover delayed drift after first equality, missing or
duplicate operation evidence, another role's operation ID, a missing actor,
and an editor reload after first equality. Simulated runs retain acceptance
`none`.

## Capability inventory (updated after 87e84a7d)

| Required case | Runner support | Remaining work before physical acceptance |
| --- | --- | --- |
| Concurrent app/browser/file insertion | `append` | Fresh current six-role readiness and independent reopen |
| Same-position insertion, Unicode | `same-position`, `unicode` | Fresh current source receipts |
| Overlapping replacements | `overlap-replace`, `file-overlap`, `partial-overlap` | Explicit deletion without inserted marker is not supported |
| Offline and reconnect | `offline` for an app/browser | Rotate every supported role; direct-file offline state is not defined |
| Pending native crash/restart | `restart` for either app | Fresh candidate and every supported role; browser restart is missing |
| Invalid intermediate pack repaired atomically | `transientInvalid` for either file actor | Fresh physical evidence; malformed metadata variants need scenario design |
| Same-write attachment update | `assetReplacement`, paired `assetReplacements` | Same-entry race remains diagnostic, without retained losing-byte attestation |
| Close under traffic | `closeProbe` for PC app | Other editor roles need guarded close/reopen protocol |
| Independent durable reopen | `rounds: 0`, `expectedBaselineHash`, `expectedAssetHashes` | Fresh processes and fixture identity from preceding physical receipt |
| Sustained typing | Implemented in 684406ad with bounded real chunks and ordinal evidence | Current private candidates and physical runs still required |
| Undo/redo | Staged real keyboard history protocol, current uncommitted slice | Native compile and physical history journey still required |
| Multiple fields | Not implemented | Separate field protocol; navigation title is currently fixture identity |
| In-place/rapid save, whole-pack creation | Not implemented as explicit scenarios | Ordinary file adapter operations plus scenario-specific accounting |
| File/folder move, case-only rename, duplicate identity, delete/restore, stale writer | Not implemented | File lifecycle input and path/identity/recovery observation protocol |
| Lost ACK, retained older journals, authorization changes | Not implemented as matrix scenarios | Explicit supported fault/identity operations and retained work evidence |
| Source/bundle/browser attestation | 87e84a7d validates observed artifact/runtime/principal pins and fresh restart attestation | Build coherent private candidates, trusted pins and real readiness; see physical-actor-identity receipt |

## Original sustained input design (implemented by 684406ad)

Do not implement a sustained-typing flag by rapidly sending multiple current
`edit` messages: the protocol permits one `applied` event per role/round and
native actors presently accept only append, insert-start and replace-selection.

A faithful next slice adds an optional bounded `inputSequence` to one planned
editor operation, with at most 16 keyboard chunks, 1–50 Unicode scalar values
per chunk and a total deadline. The existing final unique role marker remains
one logical operation. Each actor must type chunks through its existing real
keyboard/input path, report each completed chunk's ordinal and monotonic input
time, then send the one final `applied` event. Both file actors continue ordinary
planned filesystem writes concurrently. Partial sequence failure stops mutation
and preserves the accepted chunk prefix in observations and the receipt.

Required native edits would be limited to
`mac/Sources/TextText/NativeStressRunner.swift` and
`windows/TextText.LiveAcceptance/Stress.cs`, with their existing relay transport
forwarding the bounded JSON unchanged. The browser adapter needs the matching
real keyboard sequence. Never call Y.Doc, checkpoint/save methods or production
transport hooks to simulate typing. Before enabling the flag, runner tests must
reject wrong role/round, skipped or duplicate chunk acknowledgements, an early
final acknowledgement, omitted final markers, and editor replacement. Native
fixtures must establish surrogate/combining-mark handling and deadline behavior.
This design does not itself implement or attest sustained typing.

## Verification

On the Mac, all 61 runner, file adapter, browser adapter/session and editor
projection tests passed in 32.05 seconds. Command:

```sh
node --test sync/stress/stress.test.mjs sync/stress/file-adapter.test.mjs sync/stress/browser-adapter.test.mjs sync/stress/browser-session.test.mjs sync/stress/editor-projection.test.mjs
```

Local transcript: `/private/tmp/texttext-stable-six-samples-verified-20261018.log`.
The four focused new orchestration tests also passed separately in 8.47 seconds:
`/private/tmp/texttext-stable-six-samples-focused-20261018.log`.
`git diff --check` passed for this slice. No native code, private test actors,
installed applications, deployment, account configuration or physical fixture
was changed by this runner preparation.
