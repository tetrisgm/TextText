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
