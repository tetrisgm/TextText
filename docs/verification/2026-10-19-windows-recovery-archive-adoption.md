# Windows recovery archive adoption correction

Source: `f11bbcb68eb2de56bb028ce8f317c5113e14221d` (three recovery files only).

The installed F41 normal app crashed after the supported Keep saved work action. Windows .NET event 1026 identifies `AccountStateAdoption.Paths`: a genuine `shared-editing/ad815a9d-0158-4088-bd80-fd1317ffee8c/archive-8edac801a10e426b86ac0b3bbbe28a83` directory was rejected. It contains the native recovery writer's checkpoint and recovery metadata. No ownership transaction or owner marker was published; original packs and pending work remain preserved.

The correction recognizes the native archive directory and five known leaf names with bounded regular-file reads, leaving inactive archive bytes unchanged. Unknown directories/files still refuse adoption. Active adoption and account checks are unchanged. The normal asynchronous folder action now catches InvalidDataException and reports that saved work could not be connected rather than crashing.

Focused adoption suite: **76 PASS on actual Windows and 76 PASS on Mac**. The four added assertions exercise actual RecoverAsync archives, unchanged original packs/pending operation, and unknown directory/leaf refusals with unchanged state. Existing interrupted adoption, separate-process restart, foreign account and malformed recovery cases also pass. The first focused runner used an incompatible temporary-parent prefix; its four new assertions passed, then the existing restart fixture refused. That harness-only failure is preserved; correcting only the isolated runner prefix produced both green suites.

Private proof:

- `/private/tmp/texttext-pc-adoption-archive-fix-focused-20261019/retry2-result.json` (exit 0, source hashes unchanged, stderr empty).
- `/private/tmp/texttext-mac-adoption-archive-fix-focused-20261019/retry2.stdout.log` (76 PASS, process exit 0).
- `/private/tmp/texttext-pc-normal-reviewed-acceptance-20261019/after-user-selection.json` (original crash).

The separate F41 + four portability-test overlay Windows full Core gate passed 1,768 checks. It is not relabeled as this product correction. Exact f11 official candidate build/install and normal open/save/close/reopen acceptance are recorded separately after completion.
