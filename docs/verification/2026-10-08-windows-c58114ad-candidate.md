# Windows candidate matching Mac 1202

Source: `c58114ad`, matching the installed Mac's shared client.
Actual PC build log: `/tmp/texttext-windows-c58114ad-build.log`.
Candidate:
`C:\Users\Shokunin\dev\texttext-client-c58114ad\windows\build\candidate-c00921978cc04b6d938bc57cd7c3a4cf`.

The explicit build completed successfully: runtime archive checks, native Core
and Agent suites, all 326 shared-client tests, TypeScript, UI packaging,
self-contained desktop publish, native desktop smoke and sealed receipt.
The desktop smoke exercised failed renderer flush, preserved usable editing,
durable activation ordering and acknowledgement retry.
Smoke receipts:
`windows\build\smoke-receipts-4cbeeac8a22d4099bcb7e029e13c6ecd`.

This is a verified candidate, not an installed-client acceptance. The older
installed process remained running at the last check. Preserve it until the
owner saves and closes it; unsaved state is unknown. No install or forced
termination was performed. One temporary WebView directory remained after
the smoke; it was not removed.
