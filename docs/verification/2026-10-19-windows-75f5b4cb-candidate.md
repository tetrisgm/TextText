# Windows 75f5b4cb normal candidate

**Verified, uninstalled.** Frozen product source `75f5b4cbc9501d0eabd55eff0851ffd46c0cca80` independently matches Mac: 3,320 files, source-input SHA-256 `94ba0737f5e95c36ab772adde8e05c6ace27da661f7ea3360b1ffc25fef4072f`, archive SHA-256 `2a15170d8eaaf0a964a825412afbe144822fef5dced18c48064c3fe21ade4e20`. Five bootstrap helpers were verified against exact Git blobs and byte hashes before import. No owner dirt or overlays entered the source archive.

Unchanged official `windows/scripts/build.ps1` passed: Core 1,677 assertions, Windows bridge 120 checks, private actor helper 68 proofs, Agent, client 749 tests/58 files, TypeScript, shared UI, publish and actual interactive desktop smoke. Supplemental compiled Smoke passed owner/composition cases and all 152 policy vectors in each visible, hidden and production-factory phase, plus 70 forged/reload refusals, without required-case skips. Actual WebView2 runtime: `155.0.4283.62`. Build-only fixture prefix preparation and Windows cwd normalization remain explicitly recorded; Chromium assertions were not replaced or claimed from fixture preparation.

Candidate `candidate-38a6974777814447a9912bc6d0645cbf`:

- EXE SHA-256: `0cfbc2e5f2e716140436999fcbb5e92221e92d7e735aae9f6dd18c44cb852558`.
- Main DLL SHA-256: `7d37b5c89b44e6fbf829c97b4770b28d378a2e3f81b5784a10abcbed98e8c13e`.
- Verification receipt SHA-256: `48a0ff3e2d7ed9044ecc0f699b797867b0eb13680e57db036a2d4e7771c06549`.

Full source verification before/after build and after supplemental remains identical. The generated TypeScript cache was retained outside source with its inode/hash evidence; no source guard was relaxed. The official receipt was independently reverified after all stages.

The first two external wrappers refused before any official gate: native stderr escalation, then a null process ExitCode. Both attempts remain preserved. A reduced actual exit-0/exit-7 test proved corrected process-status handling. The successful wrapper later waited for an idle MSBuild worker, which naturally exited around 15 minutes; no signal, duplicate supplemental task or rebuild was used. The complete chain exited zero.

Final postflight reports no owned children, normal app absent, supplemental task removed, zero matching 4625/4740 events during the fresh attempt, and mitigation retained. Legacy saved work and its backup still match: 1,110 files, 103 directories, 7,340,498 bytes; inventory `16faaf065abc0843f8196e9be33f3181eccca7960a7dba6062a7b00d6cf1f062`. Unbound/conflicted work remains untouched; no adoption or normal app launch occurred.

Private proof root: `/private/tmp/texttext-pc-frozen-75f5b4cb-20261019-retry3` and the same PC Temp basename. See `normal-build-result.json`, `final-artifact-proof.json`, `fixture-provenance.json`, `desktop-smoke.log`, `supplemental-task.json`, `final-safety.json` and `final-legacy-backup.json`. The candidate is under `normal-build/source/windows/build/`. Earlier attempts use the unsuffixed and `-retry2` roots. Runner-only lifetime/emitter commits are separately attested and are not relabeled as part of this frozen product candidate. No new private actor seal, installed acceptance or T24 completion is claimed.
