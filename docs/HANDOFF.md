# TextText handoff

## Objective and scope

Finish the [27-task checklist](plans/shared-app-finish-checklist.md) and [master plan](plans/shared-app-durability-execution.md): durable synchronization and consistent Mac/Windows/web behavior. Continue ready work until completion or a dependency prevents all useful work. Public Mac distribution and OpenAI account sign-in are excluded. Source tests, private actors and historical physical runs do not replace current installed acceptance.

## Current work, October 18

Product checkpoint **`55890b9cc8dbb672360c706455953a165b6258b6`** contains the account identity refresh, authored-title whitespace repair and bounded external leaf-move driver. Current builders use pristine archives, excluding unrelated edits. Exact cross-machine proof: **3,100 files**, source SHA-256 `15e581ca2c785859dda04e3347673d0426634593504a64ed30508f6722cc8052`, archive SHA-256 `1705cae13aa972bed9326a64bb35ef65b409f7c3d0bceee6a99604cf6e9e69d7`.

- Mac 1265: all ten actual actor-source tests passed; genuine full 22-check release gate passed (5,140 web tests, 161 optional skips; database 123 plus four scale checks; native unit). Separate sync verification and normal signed build/health are running. No candidate installation or final acceptance claimed yet.
- Windows same-source normal candidate and private actor passed and are sealed. Required checks: 1,089 Core, 100 bridge, 15 new actor-helper, 12 Agent, 521 shared-client checks, TypeScript/UI/publish and actual isolated desktop smoke. Candidate `candidate-602c9721fe434d5b8b00e24f896b9be3` under the private PC frozen-source directory. No owner-app actions or installation.
- Future browser lost-acknowledgement driver: private isolated CDP mechanics preparation only. Wait for the designated short browser slot after the Mac pipeline exits; no current-candidate claims from future source.

## Actual delivered state

| Surface | Verified current state |
| --- | --- |
| Mac | `/Applications/TextText.app`, **0.204 (1264)**, source `cd65ea30`. Official install/runtime health pass; actual account refresh, normal reopen and explicit saved-work review passed. Clean new-note server read/quit/reopen passed. App normally closed for current native gates. |
| Windows | Installed F994 candidate `candidate-3f89d7fb5e0a4c899087c6d79ef28593`; owner-session PID 40636 remains open. Human saved-work review/normal close requested because this chat cannot operate that PC window. Preserve pending work; never force close. |
| Oracle | `texttext-oracle-20261018T174659Z-f994b8f`; active service, exact public/loopback/source identity, validated pre-migration backup and all 13 authenticated smoke checks passed. Previous release retained. |
| CLI | Signed source `cd65ea30`, shim targets `~/.local/share/texttext-cli/source-cd65ea30/texttext`; signature/help verified, previous binary retained. |

[Mac 1264 installed review](verification/2026-10-18-mac-1264-installed-review.md), [interim delivery](verification/2026-10-18-interim-installed-delivery.md), [coherent build scope](verification/2026-10-18-coherent-candidate-build.md).

## Findings and retained work

The installed rapid-input note displayed generic server rejection and retains its acknowledged batch plus later pending work. Local reduction proved a real whitespace-title serialization conflict after acknowledgement; [repair and exact status limits](verification/2026-10-18-authored-title-whitespace.md) are committed. That controlled representation conflict maps to 503 and does **not** prove the original generic 400/413/422 retirement's precise cause. No speculative second fix or automatic retirement revival was added. Generic retired journals remain fail-closed; the existing explicit recovery-copy flow must preserve the draft before clearing its old journal.

Actual legacy ownership review preserved both archived pending records exactly. The active record changed only its explicitly reviewed verified account ID; all pending updates/batch remained exact. A fresh verified pre-1265 backup preserves 2,373 vault files, 781 actual device-state files and prior build 1264 at `PreinstallBackups/20261018-before-1265-title-fix`, manifest SHA-256 `450e54e8b7c20a574ad468955d028eddd83d6efd55721a811125a653ab39586f`. All retained records include four pending checkpoints, three updates and two batches; current-name-only counts are not the total. Never roll an older binary onto upgraded candidate-written state; use forward recovery and retain originals.

## Open dependencies and next actions

1. Finish the current Mac 1265 pipeline; release its UI/compiler slot only after full child exit. Then the bounded lost-ACK diagnostic gets its short slot before actor/CLI/Oracle compilation. Build/reseal same-source private actors and CLI, install the verified normal candidate and repeat actual new-item/close/recovery checks.
2. Windows human review/normal close is pending. After normal exit, create a fresh stable actual vault/device-state backup, verify the sealed candidate and use the official installer. Do not fabricate ownership markers, kill the owner app or use ad hoc native UI automation.
3. Oracle free space is near the next backup guard. Approval was requested for **ten exact redundant October 9 upload archives**, 2.91 GiB; no deletion occurred. The earlier approval covered eleven October 8 archives only. Refresh backup/mtimes/running-work and revalidate exact approved paths before deletion. Standard web-only deployment remains authorized; preserve current/previous/unpacked releases and backups.
4. Existing hosted TextText MCP OAuth requires renewal. Plugin-management discovery exposed no managed TextText reconnection tool; inspect the existing app connection through supported UI after native gates. Do not create another connection/token/profile or substitute an incompatible client flow. Password/2FA needs the owner. The required existing `Shoku's Space/My Notes/TextText Changelog.textpack` remains inaccessible through the current local workspace; no duplicate was created.
5. PC workaround persistence is clean through fresh source-build interval **18:47:26–18:53:23 UTC** (zero matching Shokunin 4625/4740), plus an earlier clean overnight window. Last boot remains October 14. Coordinated reboot proof is pending while other work is active. Existing authorized Edge-fix coordination chat was informed; no reboot/config change.

## Remaining acceptance

- T19–T20: shared visual/light-dark and permission controls have source/browser/native receipts. All five templates passed CLI guarded edit/replay/stale refusal; gallery/talk creation and immutable custom look v1/v2 passed. [Actual installed gallery asset import](verification/2026-10-18-installed-gallery-owned-asset.md) proves exact owned PNG bytes and correct authoritative identity. Wider assets/UI/assistant/MCP, folder defaults and retirement remain. One retirement proposal is staged, unapproved and expires at 19:11:37 UTC; do not treat it as applied or blindly reuse an expired preview.
- T21–T22: current all-six readiness and independent reopen remain prerequisite. [Leaf-move driver](verification/2026-10-18-external-leaf-move-driver.md) and [required native gates](verification/2026-10-18-private-actor-readproof-gates.md) pass source checks; no physical move campaign claimed. Whole-folder case, multi-field, malformed repair, ordinary file writes, browser close/crash and native close traffic drivers are available. Creation/deletion/restoration, general folder move, losing binary recovery and lost ACK still need applicable bounded physical protocols.
- T23: historical real viewer/edit/revoke/regrant passed; current native account transitions and agent identity remain. Preserve the existing second account's revoked pending work; create no accounts.
- T24–T25: 100 seeded mixed rounds, bounded 60-minute soak, resource/idle bounds and actual release performance distributions remain. Diagnostic drafts/proxies are not acceptance.
- T26–T27: coherent final delivery/installed matrix, required existing TextText changelog and evidence closure remain.

## Working constraints and references

Use main, no worktrees. One heavy Mac compiler/gate at a time; actual-PC checks may run independently. Preserve unrelated `mac/Package.resolved`, assistant attachments, tabs test, `mac/scripts/__pycache__/` and `scripts/.probe-editor.ts`. Exact owner Package.resolved SHA-256 is `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`; save/restore exact bytes around Swift, never reconstruct from HEAD.

[Prior detailed source/physical references](archive/texttext-handoff-2026-10-18-before-1265.md), [execution ledger](plans/shared-app-finish-checklist.md), [six-client acceptance contract](verification/six-client-sync-acceptance.md), [Oracle operations](../release/oracle/README.md), [Windows lockout receipt](verification/2026-10-11-windows-account-lockout.md).
