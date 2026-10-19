# Resource ownership validator verification

This pure validator accepts independently pinned launcher-receipt bytes plus matching fresh OS process evidence. A caller-supplied current PID or SSH supervisor identity is insufficient: run, role, source, generation, task, session, module hash, browser profile scope and PID/start/executable hash/session must match trusted expected pins. The validator performs no process discovery, receipt-producer authentication, authorization, task creation or signals. Arbitrary matching JSON is not proof of genuine ownership.

The future OS collector must evaluate freshness on its own platform clock, bracketed by its monotonic request times. Never compare Mac local now directly with PC observed UTC without uncertainty. Node readFileSync Buffers require an explicit detached new Uint8Array copy before validation. Getter/coercion, unknown/symbol fields, changed PID/start/hash/session, stale/future observations and missing task/profile/module facts are refused.

Returned scope is bound-process-tree; renderer coverage is explicitly unavailable. Mac WebContent/GPU XPC responsibility and shared coalitions are not inferred as owned descendants. This is neither whole-app resource accounting nor a T24/T25 measurement.

Controlled verification: 24 behavior tests, including real local file Buffer conversion and zero-invocation adversarial runId/role coercion tests, plus one test proving default discovery, recursive source fingerprint sensitivity and additive official Windows/manual test-list registration. The combined main Node gate passed 62 tests: 25 ownership, 20 finite sampler and 17 sync verifier, one worker and zero skips. No actor, browser, collector-positive runtime or physical campaign was launched. Task-emitter drafts remain separate scratch, disabled and unmerged.

Evidence: /private/tmp/texttext-resource-ownership-af7-20261019. Earlier 22/23/24 scratch gates remain attributed to their original bytes; current main registration adds its separate assertion. Pure-module receipt hashes and before/after source proof are recorded in main-final-manifest.json.
