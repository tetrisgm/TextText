# Finite owned-process sampler verification

Stage1 T24/T25 instrumentation only. No product counter hooks, frame probes, server changes, persistent jobs, or physical endurance/performance claim.

The sampler binds an existing ownership-evidence hash to run/role/source context and actual PID/start/executable hash/session. Mac uses ps CPU/RSS and libproc microsecond start/path identity; Windows uses CIM parent relationships and GetProcess CPU/WorkingSet/private bytes. Process-tree membership and identities are checked around capture. No command-line contents are emitted. Limits: two hours, 1,441 samples, 256 processes, eight MiB output; default five-second cadence. Output is create-only; no process signals are sent.

The version1 DTO requires own plain data and rejects accessors, symbols, sparse/foreign arrays, unknown fields, and malformed values. Complete observations must contain only descendants reaching the bound root. RSS/private totals are recomputed from raw entries; private total is null if any process lacks that metric. Missing/denied/reused/changing processes, late dispatch, capture overrun or regressed counters produce incomplete/null metrics. Standalone parsing rejects CPU claims; a stateful series validator recomputes deltas/rates from its validated predecessor, immutable scope, ordinal, cadence and due time. RSS sum is not unique physical memory; Mac private memory remains unavailable/null.

## Gates

- Mac: 20 sampler tests plus 16 sync-verifier tests, **36 passed**.
- Actual Windows: **20 sampler tests passed**, including source registration.
- Renamed current source: three actual OS snapshots at 0/5/10 seconds per machine. Own Node children Mac 84515 and PC 44140 exited naturally code0/no signal. Windows console descendant was included. Source hashes were identical before/after both gates.
- Official Windows and manual native test lists register the unit test. Existing recursive sync discovery/fingerprint covers the new source. No actor runtime inventory pin is added because actors do not import this sampler.

Current evidence: /private/tmp/texttext-resource-sampler-main-final-20261019, including source-before-final.json, both source-after proofs, platform sample/ownership/result files and final unit logs. Nominal controlled binding references base b4; it is not an attestation that the new sampler existed in that commit or that product resources were sampled. The exact new sampler bytes are independently hashed in the final manifest.

Earlier scratch samples retain their original source provenance. Original incomplete/refused gates remain: capture completion was initially mistaken for dispatch cadence; the Windows fixture initially assumed one process; and a renamed Mac gate exposed a timer waking 0.27ms early. The sampler now records capture duration separately and re-waits until the actual due time without relaxing late-dispatch bounds. Final gates above executed the renamed, hardened bytes.

JS listener/document/queue counts, HTTP attempts/content commits, idle mutations, latency and compositor paint remain unmeasured. Quiet dwell remains partial T24; actual installed release-mode T25 distributions remain open.
