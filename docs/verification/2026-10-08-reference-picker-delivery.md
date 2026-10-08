# Reference-picker Oracle and Windows delivery

Source `4c84df4416b31bc11afb38a57045adc03c41dbb9` matches installed Mac 1217.

## Oracle

Verified Linux ARM64/Node 22 archive deployed as
`texttext-oracle-20261008-4c84df44-references`. Build, TypeScript, archive
verification and deployment passed. All thirteen authenticated live checks
passed; previous release retained. Preflight checked the recent backup and
24 GiB free space. TextText and all three Algorave services remained active;
HAProxy mtime remained unchanged after deployment.

A fresh real Safari navigation to the canonical verification item loaded the
updated client with the signed-in account, custom look, saved title and Mac
1217 save marker intact. This does not reproduce the delayed picker race in
Safari; the deterministic browser regression covers that race.

Logs: `/tmp/texttext-web-references-4c84df44-{build,package}.log`,
`/tmp/texttext-oracle-references-4c84df44-deploy.log`.

## Windows

The explicit physical PC build passed native Core/Agent suites, runtime
archive regressions, 340 shared tests in 38 files, TypeScript, shared UI build,
self-contained desktop publish and actual interactive desktop smoke.
The existing NU1510 redundant-package warnings remain; no build errors.

Candidate:
`C:\Users\Shokunin\dev\texttext-client-4c84df44\windows\build\candidate-02dbe5d74f8a4df4b853fb1aa32871cf`.
Smoke receipts:
`C:\Users\Shokunin\dev\texttext-client-4c84df44\windows\build\smoke-receipts-5e06762dbc72448698418d9d132a1fda`.
Log: `/tmp/texttext-windows-4c84df44-build.log`.

Not installed: canonical old app remains running with unknown unsaved state.
Installed login, integrated agent behavior and full platform parity remain
unverified. No public Mac release or persistent build/install job was added.
