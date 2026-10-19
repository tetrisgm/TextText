# Windows a0413982 coherent candidate

**Verified and uninstalled.** Normal candidate and sealed private actor use exact source `a041398244964e627ef1a72681ea084310358c61`. This supersedes the [4eca8353 candidate](2026-10-18-windows-4eca8353-candidate.md) for the next local delivery; the [installed 4eca8353 app](2026-10-18-windows-4eca8353-installed.md) remains running unchanged. No public release or physical campaign ran.

## Source and gates

Fresh committed archives exclude the owner's unrelated changes. All five bootstrap helpers matched their frozen Git blobs and SHA-256 before import. Both normal and actor before/after proofs match the independently verified Mac archive:

- **3,237 tracked files**, input SHA-256 `9b0a660628b9359cf02350984d4595398177692cd01c004228c62a978ff4aeef`.
- Archive **85,729,280 bytes**, SHA-256 `3d9b7f4a4523322df4601f1debd6b64baf7f0ee2183b907cbd8b8e6f0dadb785`.
- Isolated private Git metadata, no remotes or shared object alternates; no source overlays or reused verification receipts.

The official `windows/scripts/build.ps1` ran without skip flags and exited 0: Core **1,638**, bridge **120**, private actor read proofs **24**, Agent **12**, shared client **728 tests / 56 files**, TypeScript, UI build, self-contained publish, actual interactive desktop/close smoke, and sealing. Official receipt verification passed again after reversible retention of the freshly generated TypeScript cache; exact source proof remained unchanged.

The official task does not inherit caller fixture variables. A separate one-off interactive run of its exact compiled Smoke assembly therefore supplied fresh policy, owner, and composition fixtures. It passed actual WebView2 **155.0.4283.62** owner/composition checks, all eight serialized vector files, **120 additional vectors each visible, hidden, and through the production factory**, and **58 forged/reload refusals**, with no skipped fixture lanes. Ordinary policy, scheduling, queue, lifecycle, and native mirror checks also passed. The invocation-owned task was removed after exit.

Fixtures were built from this archive with strict UTF-8 checks and recorded hashes. Build-only browser-fixture prefixes stop before Chromium assertions; only their Windows cwd interpolation is normalized to forward slashes. No Chromium assertion pass is claimed. That preparation process and its esbuild child exited before official npm installation.

## Artifacts

PC evidence root: `C:/Users/Shokunin/AppData/Local/Temp/texttext-pc-frozen-a0413982-7wd73u48`.

Normal candidate: `normal-build/source/windows/build/candidate-77367c42794942de9cab07f3759318ef`.

| Artifact | SHA-256 |
| --- | --- |
| Normal `TextText.exe` | `c34e0639196369e3af428f7e234ad05527775f42d0c12f3e57b5c2bb376c7eed` |
| Normal `verification.json` | `6ac9bcf0a5377b86c9e1872523e95964829b45195fa737ff76723739c2b65867` |
| Private actor executable | `1ab6e1ebb672f4ff37cd49ec7369ffec3e6c611f62fa1d229780fdcee4566c3b` |
| Private actor Core | `5bebbc0f3e7a1eeafc9f9d38f7ebd0a539e550044141adbb5dc6f923b7a106de` |
| Private actor DLL | `adca39cc9565df0415c675483992dd01a518ab40b21c78bddc029b1f8e8786d1` |
| Actor build receipt | `1d6ce4d6b34f1e9fa1a5f6da4f7f0a3c9ec7362e725d51eded55905273ea2384` |
| Actor identity sidecar | `948b93fb43444c87aa06099356caec16ab1bc25cd7d993ddff8dd362d64fb598` |

Actor outputs are under `private-actor-lf/source/windows/build/stress-actor`; standard seals are `private-actor-lf/build-receipt.json` and `private-actor-lf/StressBuildIdentity.json`. Its genuine locked dependency, shared UI, and native actor build steps passed. Artifact hashes were independently reread against the seal; both source proofs were rechecked. The actor was not launched against owner state.

## Preservation and limits

Matching Shokunin Security **4625/4740 counts were zero** from `2026-10-19T09:38:28.2596483Z` through `2026-10-19T09:47:04.9711285Z`, with another check before supplemental UI. The existing WebView mitigation remained present. Owner PID **42616**, start `2026-10-19T03:38:29.9854401Z`, executable hash and responding state were unchanged. Build children exited; unrelated Node processes predate this run and were preserved.

A fresh private backup verified **1,110 vault/device files / 7,340,498 bytes**, full stamp/hash inventory `16faaf065abc0843f8196e9be33f3181eccca7960a7dba6062a7b00d6cf1f062`, preserving the single durable outbox entry. The installed app backup verified **429 files / 548,019,080 bytes**. Selected encrypted metadata and the empty alternate legacy state were preserved under a protected current-user/SYSTEM ACL. Same-session read-only metadata confirmed the existing responding window. No adoption, recovery choice, account change, close or installation occurred; memory-only edits were not captured. Backup verification is a preflight, not permission to bypass normal close.

Private Mac evidence: `/private/tmp/texttext-pc-frozen-a0413982-7wd73u48`. Exact hashes, task cleanup, source proofs and logs are in `completion-receipt.json`, `final-verification.json`, and `backup-ready.json`. Prior F862 official failure, readiness-only refusal, and the incomplete fake-download diagnostic remain preserved separately at `/private/tmp/texttext-pc-frozen-862aaddf-awqmeb97`; none was relabeled as a candidate pass.
