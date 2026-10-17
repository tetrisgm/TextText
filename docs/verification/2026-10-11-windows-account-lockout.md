# Windows account lockout behind recurrent SSH resets

October 11, 2026; PC `DESKTOP-BAKIEMJ`, local account `Shokunin`.

## Cause and evidence

Security event 4740 records account lockouts at 8:08:20, 9:23:49, and 10:00:01 PM PDT. Before the last lockout, ten event 4625 failures between 9:55:24 and 10:00:01 identify WebView2 154.0.4258.62, local interactive logon type 2, status `0xc000006d`, substatus `0xc000006a` (bad password). The preceding twelve hours contain 174 matching failures, all from that WebView2 executable. The local policy is ten failures within ten minutes, with a ten-minute lockout.

After lockout, SSH accepts the existing key but cannot generate the Windows user token: `get_user_token`, `unable to get security token`, and `fork of unprivileged child failed`. Group matching can encounter the same token failure earlier. Temporary recovery reflected account unlock; it did not establish a username or sshd configuration fix.

The signature matches [MicrosoftEdge/WebView2Feedback #5722](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5722), including its reported workaround. The exact Chromium API call was not independently traced on this PC.

## Persistent workaround

At 10:16:18 PM PDT, created the previously absent machine policy:

- Key: `HKLM\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments`
- REG_SZ value name: `*`
- Data: `--disable-features=AutofillAiWalletPrivatePasses`

New browser root processes were observed with the feature disabled. This applies to newly launched WebView2 hosts; existing browser processes are not retroactively changed. The account lockout policy remains enabled. No account, key, tunnel, scheduled job, or authentication bypass was created.

The original `C:\ProgramData\ssh\sshd_config` was restored byte-for-byte from `sshd_config.bak-20261011T215006-before-user-match`, validated with `sshd -t`, and the service restarted. SHA-256: `1f2a13c0193ee8ce2d70f6cafbc4a30b35489a12ed99a0556af0576f478574e5`. Temporary DEBUG1 file logging was removed; its diagnostic file remains in `C:\ProgramData\ssh\logs`.

## Verification

Three complete desktop smoke runs created 18 fresh WebView2 environments, exceeding the prior ten-launch lockout trigger. All passed. Security events 4625 and 4740 and OpenSSH/Admin errors since policy installation were zero at 10:18:46 PM. Direct and tunnel SSH both passed after the original sshd configuration and service restart.

Receipts under `C:\Users\Shokunin\dev\texttext-packet-b-84feed8d\windows\build`:

- `smoke-receipts-5aca9d1e54c64ed5b70a232e44383c43`
- `smoke-receipts-7e2ba2ca7581404e99036b85a3e57e43`
- `smoke-receipts-96db9c40375d47f897af9b5288bd8a32`

The first run was part of a full passing Windows build. Candidate `candidate-dcaff9307bab48ac87f67791ec698b16` has source fingerprint `b9b0903ea5568104fb3f9d52bbdeeaae37edf3e6d46c5de6d91cc3aa3ee59884`, independently matched to a pristine archive of commit `01745e4e`. Installation verified the seal and preserved rollback at `C:\Users\Shokunin\AppData\Local\Programs\TextText-previous-20261011T221834-cbf27e3e`.

This is a verified persistent workaround, not a vendor fix or a guarantee against unrelated SSH faults. A whole-PC reboot and overnight soak were not performed. Before removing the policy after a runtime update, repeat fresh-environment launches and audit 4625/4740. Do not weaken lockout policy or clear Security logs to hide failures.

## October 17 recurrence: standalone Edge

SSH reset before authentication around 11:32 PDT, then recovered without an SSH or account change. Fresh Security XML establishes a Shokunin lockout (4740) at **11:26:28**, with ten preceding/simultaneous bad-password events from **standalone `msedge.exe`** between 11:03:43 and 11:26:28. Each successive failure was less than ten minutes apart. Another Edge bad-password event occurred at 11:39:31. The current Edge executable is 155.0.4283.45; that version inspection alone does not prove the version of every earlier process.

The WebView2 machine policy still contains `--disable-features=AutofillAiWalletPrivatePasses`, and running WebView2 processes were observed receiving it. That policy does not cover standalone Edge. This recurrence does not establish that the WebView2 policy was removed or ineffective. The SSH `ga_init`/`get_user_token` errors fall within the locked interval. The existing qualified username and key worked after recovery.

Private evidence: `/private/tmp/texttext-t09-pc-restored-events.log`, structured account/process extraction `/private/tmp/texttext-t09-pc-edge-audit.log`, and SSH diagnostic `/private/tmp/texttext-t09-ssh-diagnostic.log`. No logs cleared, identity/profile added, account protection weakened, browser killed, or machine config changed. Process-creation events did not establish the parent chain for the failed Edge PIDs. Another active PC chat is running browser checks; coordination was requested before touching its launch sites. Its responsibility for individual failure events is not proven.

Next: inspect and fix the relevant standalone Edge launch sites, preserving existing disabled-feature arguments and other active work; audit actual fresh launches, then observe later normal use. Standalone Edge prevention is still open. The earlier reboot/overnight WebView2 receipt remains bounded to its recorded window.

A second 4740 lockout occurred at **11:56:10**. Direct/tunnel access reset again and recovered after the ten-minute lockout without configuration changes. The later Security extraction still attributes matching bad-password events to standalone `msedge.exe`, including 12:06:17 and 12:07:06; it contains no matching WebView2 executable event in the sampled window. The full TextText desktop smoke and policy/composition fixtures passed after recovery. New private evidence: `/private/tmp/texttext-t11-pc-recovered-audit.log` and `/private/tmp/texttext-t11-pc-security-final.log`. The recurring standalone launch problem remains unresolved.

The next audit records a third lockout at **12:21:06**, immediately alongside a standalone Edge bad-password event for Shokunin. Ten matching Edge failures span 12:06:17–12:21:06, each successive interval below ten minutes. SSH recovered around 12:31 without configuration changes; the subsequent TextText build, full desktop smoke, portable Core and focused visual smoke passed. `/private/tmp/texttext-pc-lockout-1234-audit.log` also includes SSH failures for `FakeUser` with unknown-user substatus `0xc0000064`; those are distinct from the Shokunin bad-password events and are not evidence against the TextText key. No matching WebView2 failure appears in that sampled event list. Standalone Edge prevention remains open.

The owner's later screenshots match these older token-failure events and show successful key authentication at 12:48. The `FakeUser/FakeDomain` entry is explained by [Microsoft's OpenSSH token code](https://github.com/PowerShell/openssh-portable/blob/latestw_all/contrib/win32/win32compat/win32_usertoken_utils.c#L367-L373): after S4U token generation fails, it deliberately makes a placeholder logon and retries the real user. This matches the adjacent second-attempt token errors; it is not a new account to provision or a reason to change the SSH key.

The owner authorized coordination with the PC's “Check repository status” chat. That chat reports applying the existing feature-disable mitigation to its owned standalone Edge test launches, preserving Playwright's other disabled features, observing the merged arguments in a fresh process and no matching events during a short check. A repeated fresh-environment campaign and later normal-use observation were requested; persistent standalone prevention is not yet established by that short window.

The coordinating chat subsequently reports **18 fresh isolated headless Edge launches**, with the mitigation intact and no matching Security events in the batch's short window. Its receipts are `edge-launch-batch.json` and `edge-security-batch.json` under `C:\Users\Shokunin\scratch\replacement-scanner-20261017`. This is a reported bounded launch check, not an overnight observation or proof that every standalone Edge entry point is covered.
