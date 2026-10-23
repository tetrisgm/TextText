# Recovery list fixture alignment

Unified `6b5b6c11` stopped before delivery when six recovery transport cases rejected the newly required first native read, `files.pathCollisionList`. The production reader was behaving as designed; the mocks and two exact request-order assertions still described the old protocol.

The fixtures now acknowledge the collision read. Existing corrupt-registry refusal, fenced-history ordering, retained downloads and native scope assertions remain intact. The online/offline cases additionally verify that retained collisions are included and that the collision read binds the captured native workspace and account instead of caller-supplied scope.

Actual Mac `windows-recovery-transport.test.ts`: 11 tests passed. PC TypeScript passed. This is source regression evidence; no installed acceptance or release retry is claimed.
