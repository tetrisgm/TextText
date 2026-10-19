# Default-off PC ownership callback factory

Follow-up to [launcher sidechannels](2026-10-19-pc-launcher-measurement-sidechannels.md). The new factory connects supervisor-shaped `readLauncher` and `inspect` callbacks to the fixed production `inspectPcOwnership` adapter. It supports only pc-app and pc-web. No sampler callback, actor/task launch, all-six readiness or physical measurement acceptance is provided.

The independent caller supplies pinned genuine launcher-record paths/hashes and create-only evidence locations. Disabled mode returns before dependencies or filesystem access. Enabled configuration is strict plain data; input pins are copied. First read invokes actual inspection and retains copied, validated ownership receipt bytes and exact expected scope. Every later inspection calls the adapter again, validates fresh returned OS facts, and requires the exact original receipt bytes/scope. A separately valid changed receipt cannot replace the captured initial proof. Returned caller copies cannot mutate retained authority. No receipt is synthesized from expected values or actor attestations.

Unsupported Mac/file roles fail closed. The all-six supervisor control verifies that these missing authorities refuse before any sampler starts. Existing adapter command/freshness bounds remain authoritative; the factory adds no commands, signals, timeouts or lifetime guarantees. Sampler startup/first-line handshake, all-six executable host wiring and final whole-series duration/count/phase coverage remain pending.

## Verification

- 26 new pure controls passed; combined factory/supervisor/ownership gate76 passed,0 skips/failures, exit0. Final log `/private/tmp/texttext-pc-authority-final2-20261019.log`.
- Both executable hashes identical before/after: `/private/tmp/texttext-pc-authority-final-{before,after}-20261019.json`.
- Controls include disabled zeroaccess, strict hidden/accessor keys, run/role/source/generation/root/receipt drift, immutable copies, fresh independent invocation, valid replacement receipt refusal and unavailable-role preapply refusal. Mocked inspector only: no OS queries, tasks, actors, browser, user state or credentials accessed. This is source/control verification, not genuine launch authority rehearsal. Root owns test registration and Git index.
