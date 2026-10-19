# Native asset fixture portability

Test-only correction. Production filesystem/link guards, asset producers, capability defaults and stored data are unchanged.

## Failure and bounded correction

The frozen75f5b4cb normal1273 attempt passed its22 official release gates but failed required full sync verification: the asset helper created test roots below macOS `/var`, a linked alias correctly refused by `TextPackStore.CheckLinks`. The failed archive/log and failure receipt remain untouched. That attempt is not a candidate pass and produced no installed app.

The three disposable test roots now use the same Mac-only `/var/` → `/private/var/` convention as existing Core fixtures. A subsequent complete helper run established that Windows retained replacement history cannot exist through the Mac `AtomicWrite` fallback. Common pack/parser, actual session, principal and profile checks remain portable; the retained replacement/folder-history block is explicitly Windows-only. No changed-body workaround or synthetic history was introduced. The Windows history block is unchanged except the temp helper calls; its actual PC gate remains mandatory.

## Verification

- Mac: full `TextText.LiveAcceptance.Tests` project, explicit default-style `/var/folders/.../T/` TMPDIR, **49 portable checks passed**, plus the named Windows-history skip. Actual session capture/no-write and malformed checkpoint/profile refusals executed. No Windows coverage is claimed from that skip.
- Actual PC: exact same test SHA, **68 checks passed, zero skips**. Fresh source before/after3,332 paths identical. Eight controlled WebView2 checks also passed, with Smoke/actor compilation zero; these additional checks are separate from the portability fix. No actor runtime or seal was produced.
- Main test hash remained identical to the tested source. Mac compiler lane and PC owned children exited. PC security counts zero, ownedchildren empty, normal process absent; opaque/legacy1110 inventory unchanged.

Command: `dotnet run --project windows/TextText.LiveAcceptance.Tests/TextText.LiveAcceptance.Tests.csproj --configuration Release --disable-build-servers -p:UseSharedCompilation=false`, in a fresh owned source archive with source-local output so the existing policy test host can locate its checkout. The first external-artifacts preparation failure and the intermediate Mac history-fixture failure remain retained.

| Evidence | SHA-256 |
| --- | --- |
| `/private/tmp/texttext-asset-temp-portability-20261019/mac-helper3.log` | `739c879b04fdfc5dd0ec747561485395b50074cf0550bb0b94abc6ed9de42de9` |
| `/private/tmp/texttext-pc-asset-capability-controlled-7ef-20261019/helper68.stdout.log` | `96ad42de6d3e44d4d6dc06e13e144f9f573c9c468426c74650ff27030d8115ca` |
| PC `result.json` | `cdfd293e87efb2dea3b4e390735e0efbbffe271bae3b15c4256c4bef2fe965f4` |

PC Core DLL: `4d1bc7966d4777aece42dd30dfc685a3a01da9bd2a029d23aababee03a7e4fb1`; helper DLL: `2153c7e5704c1358d43ac693e03dd1d6b817c7c5a5f4f993ae7b971975b0f26a`.

A new coherent source ref and fresh1273 build are required. This receipt claims no new normal build, install, six-role asset campaign or production deployment.
