# Client diagnostic scratch verification

Stage2a instrumentation was developed in scratch, based on committed `af7e9325a684d5d1bfb2e1108b41763dcc88bd2a`. The exact five reviewed paths are now copied to main; relevant main gates have passed and no installation includes these counters. Normal-product image import has separately passed and is not evidence from these counters.

SessionOwner exposes detached scalar gauges from its existing map, including stored closed entries retained during an exclusive external file write. The added getter does not invoke session connection getters or callbacks, add an ownership registry, or retain session references. The af7 owner implementation outside that additive getter is byte-identical; existing tombstone/exclusion tests remain.

The collaboration client exposes owned scalar gauges and an optional constructor-enabled logical read/poll/push ledger, disabled by default. Each logical request settles once in the existing finally path; numeric overflow marks the ledger incomplete instead of throwing. Snapshots are detached/frozen. CurrentDocumentSlot represents the current client's slot, not a global Y.Doc count. Logical timeout/cancellation does not prove transport completion: physical inflight and durable commits are always null. There is no live export, native counter, server transaction counter or frame probe.

## Evidence

Fresh af7 focused gate: two files, **134 tests passed**, including 25 owner cycles, request-result parity with accounting enabled/disabled, abort-ignoring late transport completion, overflow incompleteness, accessor avoidance, retained failure inspection and the closed external-write tombstone. Previous 131-test results remain attributed to the earlier 00c3 scratch source.

Broader exact scratch client lane: **58 files / 749 tests passed**. Nonincremental TypeScript (`--noEmit --incremental false`) passed. The five source hashes were identical before and after both scratch gates; all children exited. Main then passed the same 749-test client lane, nonincremental TypeScript, and all 17 sync registration tests, with all five main hashes unchanged before/after. Private evidence: `/private/tmp/texttext-stage2a-af7-rebase-20261019`, with exact five-path hashes in `frozen-manifest.json`, source provenance in `rebase-input.json`, and `focused-af7.log`.

These controlled tests establish instrumentation behavior, not T24 endurance, zero physical HTTP requests/content writes, absence of all retained documents/listeners, or release-hardware T25 paint latency. No physical campaign was launched.
