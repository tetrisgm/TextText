# Windows shared client acceptance, 1189 cohort

Source `54f33a4e`, clean archive
`C:\Users\Shokunin\dev\texttext-verify-54f33a4e`.
Installed source fingerprint:
`5acf6a96bc2627dfa7317aa35fb56e9aea46e30aae800914d8fa09d4ced33447`.
Candidate `windows/build/candidate-6592ce8fe9084cb087d66c55c7286fe1`;
actual desktop smoke `windows/build/smoke-receipts-0579af32ac484f398134d2609783ef0b`.
Mac log: `/tmp/texttext-build-54f33a4e.log`.

Native Core/agent regressions, 269 shared client tests, TypeScript, shared UI
bundle, publish and actual native desktop smoke passed. The new permission-only
regression observes one notification after a persisted capability change and
none for an unchanged manifest. Actual smoke includes failed prepared editor
flush preserving the previous workspace and bridge.

Installed after the combined Mac gate passed, using normal guarded close.
Previous app retained at
`%LOCALAPPDATA%\Programs\TextText-previous-20261008T004938-a58c12fe`.
Account and existing workspace were retained; no forced termination occurred.
Oracle remained on compatible `43614e64`.

## Live document acceptance

The dedicated existing item `273adce8-01cb-4934-8079-c0397efc82a3`
(`Agent template creation verification 1185`) received the Mac-written
`Workspace capability verification 1189.` automatically in the open Windows
editor, with no retry or navigation. The account and four original headings
remained visible.

Windows then appended `Windows save and reopen verification 1189.` through
the real editor and clicked Save. A first automation attempt did not focus the
editor and produced no marker; disk inspection caught this before any success
claim. The corrected attempt verified visible body text before Save, then read
the actual TextPack and confirmed both markers exactly once and all four
headings. Verification scripts and UI receipts are under the candidate's
`windows/build` and `C:\Users\Shokunin\dev\texttext-*-54.ps1`.

Normal close/reopen then displayed both markers and all four headings in the
installed Windows editor at 2026-10-08T07:54:44Z (`installed-after-login.json`).
The parent independently observed the Windows marker arriving automatically
on Mac and Safari and verified both markers exactly once in the Mac TextPack.
No further verification edits were made. Early startup samples saw only the
native shell before the complete editor appeared; startup speed was not
certified by this acceptance.
