# Native future-format refusal, October 17

T17 prerequisite brought forward for the T07 account upgrade. Source-only; installed artifacts unchanged.

Mac sync state, outer shared checkpoints, materialization intents, move intents and binary intents now write an explicit version1. Their historical missing version remains readable as implicit version1; a present unsupported version is rejected before projection/replay. Embedded collaboration journals already require version1. Windows already versions these records.

The checkpoint regression now covers a future outer checkpoint as well as a future embedded journal and malformed bytes. New tests preserve a future materialization intent and projection unchanged, then recover the old unversioned intent, and refuse a future sync state without modifying its bytes before reopening the historical unversioned state.

Verification: `bash scripts/test-sync.sh --native-only` passed, including 37 Mac app tests, 103 File Provider kit tests (one separately covered no-space skip), 40 agent tests and portable Windows core. `/private/tmp/texttext-t17-future-native-final-gate.log`. The first new-test compile used the wrong fixture helper name; fixed before this passing run, retained in `/private/tmp/texttext-t17-future-native-gate.log`.

This is not the complete persisted-format inventory or a migration pass. Explicit account adoption, root ownership markers, interruption/rollback fixtures and browser profile recovery remain open. Version1 readability does not make older applications safe to write account-bound state; account enforcement is a separate compatibility requirement.
