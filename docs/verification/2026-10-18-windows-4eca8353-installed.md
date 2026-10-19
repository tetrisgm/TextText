# Windows 4eca8353 installed delivery

The owner explicitly authorized terminating the specific stuck TextText process and continuing local delivery. Exact source: `4eca8353f455d5960e5c4cd592bece0aefff70fa`; build gates and sealed private actor are recorded in the [candidate receipt](2026-10-18-windows-4eca8353-candidate.md). This receipt supersedes its installation prerequisite, not its historical observations.

## Preservation and authorized termination

PID **40636**, installed executable path and creation time `2026-10-18T17:51:45.8924098Z` were revalidated immediately before termination. The normal close request returned false; no normal exit was claimed. After preserving available disk state, only that exact process was terminated, and exit was observed. SSH could not establish whether memory-only edits existed; no claim of complete memory recovery is made.

Create-only private backups before and after exit both verified **1,110 files / 7,340,498 bytes**, including actual vault, device state, shared-editing journals and recovery files. Their full stamp/hash inventories matched exactly:
`16faaf065abc0843f8196e9be33f3181eccca7960a7dba6062a7b00d6cf1f062`.
One durable outbox entry was preserved. Neither backup changed source state or resolved pending work.

## Official installation and normal launch

The archived official `windows/scripts/install.ps1` verified the candidate and staged copy, installed successfully, and preserved the previous app at:
`C:/Users/Shokunin/AppData/Local/Programs/TextText-previous-20261018T203706-94580245`.
The initial PowerShell execution-policy refusal is retained separately; the supported process-scoped `-ExecutionPolicy Bypass -File` invocation exited 0 and did not change system policy.

The installed official source/artifact receipt verified again. Installed executable SHA-256:
`23076418e72dcb9b8fa0d9ba0e435e46611a3c9c047bb96afb6be903772dc429`.

After the matching Oracle deployment was verified, the supported one-off interactive launch used no arguments, root overrides or forced execution timer. New PID **42616**, start `2026-10-19T03:38:29.9854401Z`, runs the exact installed executable in session **1**. A read-only probe in that same interactive session verified a responding **TextText** window, handle **37881172**, at `2026-10-19T03:39:24.9830701Z`.

The initial launch wrapper could not see the session-1 window from SSH and correctly refused window proof. That raw refusal remains preserved; the subsequent same-session metadata probe supplied independent window evidence. Both invocation-owned task registrations were removed without stopping the app. No UI action, recovery choice, reset, account change or content edit was performed.

## Security and acceptance limits

The bounded post-install audit since `2026-10-19T03:30:00Z` found **zero** matching Shokunin 4625/4740 events. The existing WebView workaround remained present. No SSH identity, profile or authentication configuration changed.

Installed artifact and responding-window checks passed. Actual recovery, typing, durable reopen and all-six-client acceptance remain unverified on this installed PC; available CUA exposes the Mac only. The sealed private actor has not been launched against the owner's root. No public release occurred.

## Read-only ownership refresh

At `2026-10-19T06:13:42Z`, direct SSH still observed the same installed PID42616,
start `03:38:29.9854401Z`, session1, responding. Its exact selected private state
remained unchanged: no account-owner record or recorded AccountId, one preserved
outbox entry, and no local/baseline entry for owned article `f82e4082-97b8-4ccb-8087-70de5f0a3c86`.
The SSH-context zero window handle does not contradict the interactive window.
No adoption, UI action, launch, scheduled task or state change was performed.
Receipt: `/private/tmp/texttext-pc-normal-readonly-refresh-20261019.json`, SHA-256
`be515a3925892d20b94ba41428b658ebca8c6f20bdf5ec3ff2ae5fc47318666c`.
Supported owner review of the saved work remains the PC editing dependency.

## Evidence

Private Mac evidence: `/private/tmp/texttext-pc-stop-4eca-5dfc6f4f` (pre/post backup configurations and summaries, exact termination, official install logs, installed verification, launch refusal and same-session window metadata). The matching PC build evidence remains at `C:/Users/Shokunin/AppData/Local/Temp/texttext-pc-frozen-4eca8353-cc_bg_xy`.

Pre-launch completion receipt SHA-256: `ff1cb31ba27e59eae98ff946ae1354eff82ada11e666876fed7f8be53c81208b`. Later launch evidence is separately retained as `window-metadata.json`; it does not rewrite the earlier stopped-state receipt.
