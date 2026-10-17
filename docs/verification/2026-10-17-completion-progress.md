# Completion execution: October 17

## T01: source and installed baseline

Source: `175a9fb6` on main; pull reported already up to date. The five unrelated dirty paths listed in HANDOFF are unchanged and excluded from candidates. No running TextText/build/test process was found on the Mac; Windows had Codex-owned Node processes, which were left alone. No active TextText/dotnet build process was observed on Windows.

| Surface | Observed identity | Interpretation |
| --- | --- | --- |
| Mac installed | `/Applications/TextText.app`, 0.204 build 1260; Apple Development signature, team 52WM463HR2 | Historical local close fix; latest browser fix not installed |
| Windows installed | Verification created 2026-10-12T06:40:26.476Z; source `cedbc88fd61d51c7366bdc42346c7af7b94d96024d7a2a563ba28de553b4f680`; all seven build checks present | Matches historical candidate fingerprint; latest browser fix not installed |
| Oracle | `texttext-oracle-20261011T180600Z-136bc176`, commit `136bc1761f1bdfb49b6798d3ddd7e4b8413cd7f0`; service active since October 11 | Older than both local candidates |
| New build input | Pristine `git archive 175a9fb6`, Windows source fingerprint `5ecd94af3bd2b09e2a61bed952f11c1a084009698b846e30d773caacc04ccfca` | Excludes unrelated edits; includes `e61d2622` |

Oracle backups include daily dumps October 13–17; newest observed `texttext-20261017T042446Z-9b3abecf.dump`. Presence is not restore validation; deployment preflight still must validate backup. Installed Mac `LocalVault/app.js` SHA-256: `fe9623dab6b0e32c9fc4dd9ee0518ad623dd76f417ecaa0fe5bb898855b4a4f9`. Historical Mac build archive and six-client temporary directory no longer exist. Their durable summaries remain references, not fresh physical attestations. Browser/private-actor identities must be collected when their current builds run; no current six-client pass is claimed.

## T02: persistence observation

Existing direct `pc` SSH authenticated and ran hostname successfully. Windows last boot: `2026-10-13T19:41:28.7987090-07:00`. The existing machine policy still contains `--disable-features=AutofillAiWalletPrivatePasses`, and sshd is Running/Automatic. Since October 12, Security 4625/4740 count was zero. OpenSSH/Admin had two connection-aborted key-exchange events, a different signature from account token/lockout failures. No SSH or policy change was made.

This demonstrates policy retention through an intervening real reboot and a multi-night observation window with no logged account failures. It does not prove fresh WebView2 environment application on the current runtime; repeat launch-triggered checks during the Windows candidate build/smoke before closing T02. No reboot was initiated.

## T03: delivery in progress

Building Mac local Store shape 0.204 build 1261 from the pristine snapshot, using local PostgreSQL and the existing signed Codex helper/profiles. Log: `/private/tmp/texttext-finish-mac-1261.log`. No install/deploy is claimed yet. Next: inspect build result; preserve any required-check failures before changing source.

## T23 authorization

The owner explicitly answered “any. make your own” to the request for a second test account on October 17. Creating a dedicated TextText test account is authorized for this gate; no permission bypass is authorized. Use normal sign-in and disposable fixtures.
