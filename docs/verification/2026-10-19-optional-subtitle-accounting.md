# Optional subtitle in full-document accounting

T21/T22 harness correction, with no production document or schema change. The Windows bootstrap's preserved inspection failure is recorded in [native inspection evidence](2026-10-19-windows-private-document-inspection.md).

Schema-v1 permits an omitted subtitle. Full-document observations now preserve that omission rather than requiring or synthesizing an empty string. Explicit invalid values still refuse. Body-only operations must preserve absence exactly: an unsolicited empty subtitle remains an unplanned document change. Accepted subtitle input may create the field; operation accounting strips only those exact accepted markers before comparing every remaining document field to the original snapshot. All six final snapshots must still have identical semantic hashes.

The mixed schedule retains its existing prerequisite of a string subtitle. Its direct-file subtitle writer requires an existing authored excerpt projection; an unsuitable fixture now fails explicitly during preflight, before actor input. This does not add absent-excerpt file-writing support.

Verification on the Mac:

```sh
node --test sync/stress/multi-field.test.mjs sync/stress/multi-field-page.test.mjs sync/stress/mixed-schedule.test.mjs sync/stress/stress.test.mjs
```

Exit0: **109 passed, zero failed, zero skipped**. Includes absent-field preservation, planned field creation, invalid values, hidden metadata changes, existing six-role accounting, mixed schedule bounds and coordinator failure/reopen regressions. Log: `/private/tmp/texttext-optional-subtitle-accounting-20261019.log`.

These are source/orchestration tests, not a physical acceptance run. New browser/file driver seals must include this change before relying on it. Existing sealed4c drivers are preserved as earlier artifacts; no source patching or relabeling is permitted.
