# Windows 35c726dd normal and private actor candidates

Exact source `35c726dd90328c7bf0428d2637f28250cec9f9c0`. Both actual-PC builds exited 0 in fresh private
archives with isolated Git metadata. Before/after proof matches: **3,148 tracked
files**, input SHA-256 `204b24febad28218922738dfee36d196a91097c3a1b672c0d5606a7ef23abdde`, archive SHA-256
`2671f8cafa80129349faaa295c2819ca340973080575c04241202f39a7ac06f2`. No uncommitted source overlays.

## Official normal candidate

`C:\Users\Shokunin\AppData\Local\Temp\texttext-pc-frozen-35c726dd-th5lyalm\normal-build\source\windows\build\candidate-03226affe903495098109cc5125406ab`

The supported `windows/scripts/build.ps1` path passed locked dependency/runtime
checks, Core **1,104 assertions**, bridge **106 checks**, private actor helpers
**24 checks**, Agent **11 checks**, renderer flush check, shared client **588 tests
in 52 files**, TypeScript, shared UI packaging, self-contained publish and actual
isolated native desktop/close smoke (**20 assertions**). The official candidate
receipt verified twice. Strict source proof remained unchanged after reversibly
retaining only the proven generated TypeScript cache outside the source archive.
Existing NU1510/dependency warnings were not compiler failures.

| Normal artifact | SHA-256 |
| --- | --- |
| TextText.exe | `232b9588c2b71bd2a2d0d62f50abd68291c8aa492284225f7dbbe12217c5163a` |
| TextText.dll | `261d0be5af1fb02d7a2dd9a0674909541413b1f7815de549c9dc8aad2e883afb` |
| TextText.Core.dll | `058ee40c1bd8d275b36cc9d8e67928d0a5d214a0fe455da78041fdd8c7267970` |
| Assets/app.js | `f042044ee1ae10c58a8125571d7e0d8db074b100fbdd92b24b79eef4ac91fc21` |

Smoke receipts: `normal-build/source/windows/build/smoke-receipts-e727e5965c454a05bd211bf4174d1538`
under the private evidence root below. The owned temporary WebView smoke directory
`texttext-desktop-smoke-d7d9fb65-c207-4547-89cb-24ce44225e0c` remains preserved.

## Sealed private actor

The unchanged frozen-source private build wrapper passed all three required
steps: locked npm, shared UI, native actor compile. Its strict before/after source
proof matches the normal candidate. Sidecar:
`C:/Users/Shokunin/AppData/Local/Temp/texttext-pc-frozen-35c726dd-th5lyalm/private-actor-lf/StressBuildIdentity.json`.
Source build receipt SHA-256: `ab751430abfd82d7cf70f4e9089bf14660d7eb4d8bd72b46ae168c17e431fe15`.

| Private actor artifact | SHA-256 |
| --- | --- |
| MainWindow assembly | `1e59fefce6ec296707c65b2e8225f9b1d4c4b4e73a3a147b2497e54417b708b2` |
| Core | `a96ad49b723b7ae94b99e1b849a3e03817a3076a3f42c66c3fcc0d7597fdf219` |
| LiveAcceptance actor | `797096faff4f00f14a40575bfe766b65c0bf2b332e35a82c22b712cae5f971da` |
| Existing dotnet host | `21a46f1e5235cf4e844b9de5429f0e198b9c97a41f0503a66442f1d639ca3ee6` |

Normal and actor shared UI hashes are identical. These are trusted local build
receipts and observed artifact pins, not physical collaboration acceptance.

## SSH/account observation and delivery boundary

Valid bounded Windows Security queries found **zero matching account login
failures (4625) or lockouts (4740)** during
`2026-10-19T00:23:40Z` to `2026-10-19T00:29:43Z`. The existing WebView workaround
remains present. No SSH identity, profile, tunnel, policy, credentials or account
configuration changed; boot time remains October 14.

**Not installed. Neither candidate was launched against the owner's workspace.**
Owner process **40636** remains responding in session 1. Its guarded normal-close,
durability/recovery review and backup verification remain prerequisites before a
later authorized installation. The isolated smoke proves its own fixture's close
behavior, not that the owner process is safe to terminate. Earlier candidates,
backups and evidence remain preserved. No public release occurred.

Evidence root on PC:
`C:/Users/Shokunin/AppData/Local/Temp/texttext-pc-frozen-35c726dd-th5lyalm`.
Copied Mac receipts/logs: `/private/tmp/texttext-pc-frozen-35c726dd-th5lyalm`. Includes normal-build-result.json,
normal/actor process results and stdout/stderr logs, exact bootstrap/source
manifest, actor build receipt and sidecar, and security-start/end.json.
Completion receipt SHA-256:
`3d07ecd12fcd92db552fd36ec663bcf9692266f6a58600730d6f0b54b3f798f0`.
