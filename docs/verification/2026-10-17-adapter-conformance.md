# T06 adapter conformance completion

October 17; source based on `1f69ca35` plus the named test/fixture/manual-runner changes in this receipt. Production persistence code was unchanged. Adapter-level cases are verified; account ownership (T07), physical offline/window campaigns (T04/T09), provider behavior (T15), crash boundaries (T16) and supported-version upgrades (T17) remain separate required gates.

## Added production-path cases

`sync/fixtures/checkpoint-unavailable.json` supplies the same unavailable-projection scenario to the client, Mac and Windows tests. Each starts from a durable checkpoint, retains a later accepted edit, refuses acknowledgement while the projection is absent, preserves prior durable bytes, and retries after repair with a fresh store/client. Browser/native-boundary tests also assert no remote push before persistence succeeds; the native stores have no transport side effects and Windows asserts the remote upload count is unchanged.

Mac adds unsupported journal version, malformed embedded journal and malformed outer checkpoint cases. Each fresh read and materialization rejects without rewriting the unsupported bytes or projection. Restoring the known prior checkpoint permits the pending edit to checkpoint and reopen. Existing Windows future-checkpoint, mutation/creation receipt and sync-state tests cover the native version boundary; browser migration/unknown IndexedDB schema tests retain their original data.

## Real disk-full tests

Manual commands, never scheduled or part of ordinary builds:

```sh
python3 scripts/test-checkpoint-nospace-mac.py
```

On Windows from the committed source checkout:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows/scripts/test-checkpoint-nospace.ps1
```

Both runners create a fresh, tiny image; test code requires the exact marker and bounded volume capacity before filling it. Neither operates on an existing disk or user workspace. Images and logs are retained; successful and failed runs detached every owned image. Mac uses a 32 MiB HFS+ image. Windows uses a new 64 MiB VHD, verifies it is neither a boot nor system disk and is still RAW, then initializes/formats only the disk returned by that exact image's identity. Its temporary drive letter disappears on detach. No persistent jobs or machine settings were installed.

Both production checkpoint implementations reject actual no-space writes without acknowledging the newer generation; the previous journal and projection remain exact, and remote upload is prohibited. After measured space repair, the same pending work checkpoints and reopens with generation2 and pending state retained. This is a filesystem no-space test, not a physical power-loss guarantee or an APFS/iCloud/SMB provider attestation.

Mac final receipt: `/var/folders/tq/_6yt1vp555qcj2jwgxmz060w0000gn/T/texttext-checkpoint-enospc-xsxlb7j8/swift-test.log`; the exact `testCheckpointNoSpacePreservesPriorGenerationAndRecovers` ran and passed. Additional zero-test bundles are not counted as evidence. Runner exit0; image detached. Log `/private/tmp/texttext-t06-enospc-reusable.log`.

Windows final receipt: `C:\Users\Shokunin\AppData\Local\Temp\texttext-checkpoint-enospc-1691a28257414af9a9aa59fe3265d12b\core-test.log`; full core suite plus all real disk-full assertions passed, empty stderr, runner exit0. The test measured 53,620,736 free bytes after repair. Log `C:\Users\Shokunin\dev\texttext-checkpoint-nospace-final.log`. Six owned Windows fixture images and all owned Mac images were checked: zero remain attached.

## Harness failures preserved

- The newer Mac `diskutil image create` failed with a generic platform error; the compatible `hdiutil` runner worked. Its deprecation warnings remain in the log. An initial incorrect `-format` option was corrected to the documented blank-image `-type`; no product code changed.
- Windows deletion initially left zero reported free bytes, so retry was correctly refused. The final runner holds the fill file through the failure and truncates it before close/delete; it asserts measured free space before retry. Both [Windows no-space codes](https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--0-499-) are accepted as no-space, rather than accepting an arbitrary IOException.
- PowerShell native-stderr promotion and `Start-Process -Wait` descendant waiting obscured the first diagnostics. One exact owned hung harness was stopped after PID/command validation and its exact image detached; no compiler server was stopped. The final runner owns a bounded `System.Diagnostics.Process`, captures stdout/stderr, runs the compiled core assembly, checks its actual exit code and asserts the required test executed. Earlier successful core assertions hidden behind a wrapper error are preserved but not used as the final exit0 receipt.

## Final checks

- 102 focused collaboration/navigation tests pass: `/private/tmp/texttext-t06-unavailable-client.log`.
- Shared client gate:411 tests pass, exact-source receipt recorded: `/private/tmp/texttext-t06-client-gate.log`.
- TypeScript exits0: `/private/tmp/texttext-t06-unavailable-tsc.log`.
- Required native sync gate exits0, including the new absent-file and malformed-schema Mac tests and portable Windows core: `/private/tmp/texttext-t06-native-final.log`.
- Real Windows core, absent-file and disk-full recovery pass in the final image run above.

The [case matrix](adapter-conformance-matrix.md) explains platform not-applicable cases. Ordinary CI/native gates skip the explicitly isolated Mac disk-full test; only its manual receipt establishes that case. No skipped or absent test is counted as passing. Full installed acceptance is not inferred from adapter conformance.
