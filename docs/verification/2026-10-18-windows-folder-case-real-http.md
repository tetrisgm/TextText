# Windows folder case propagation over real HTTP

## Scope

Two independent actual Windows production Core participants passed against an owned Mac HTTP fixture using the real filesystem engine, folder planner/executor, HTTP transport, durable native state and recovery APIs. This is not desktop, TLS, real authentication, SQL metadata, or four/six-client acceptance. The fixture uses in-memory metadata and an explicitly pinned virtual HTTPS-to-private-HTTP test handler; production transport guards are unchanged.

## Verified

- A native seed and B native pull retained one stable item, exact complete TextPack bytes, schema/projection metadata, attachment bytes and an empty child folder.
- An ordinary Windows directory case rename preserved the actual directory identity. A committed response loss left the exact native command durable; a fresh process replayed the same UUID, adopted its receipt, and B converged without child file rename/deletion fallback.
- A concurrent server empty-folder addition caused a preserved pending command. Native inspection and explicit cancellation obtained a durable server tombstone; replay of that original command refused. Local bytes remained unchanged, and an ordinary spelling restoration allowed sync to resume.
- Two subsequent idle rounds for both clients changed only manifest counts (11 to 15): uploads 1, downloads 2, file renames 0, deletions 0, folder requests 4, folder publications 1, recovery requests 3 remained unchanged.
- Missing ownership marker, mismatched private token digest, invalid bind, and unauthorized requests refused before workspace mutation. The fixture server was stopped after completion. Tokens travel only through private environment/files; receipts contain hashes.

## Evidence

- Final portable transport-only rerun passed: `/private/tmp/texttext-native-folder-http-mac-final.log`.
- Actual-PC log: `/private/tmp/texttext-native-folder-http-lan-fourth.log`.
- Full source/input/output receipt: `/private/var/folders/tq/_6yt1vp555qcj2jwgxmz060w0000gn/T/texttext-folder-http-lan-LlLcGF/receipt.json`.
- PC scratch: `C:\Users\Shokunin\AppData\Local\Temp\texttext-native-folder-http-xIClgX`.
- Core DLL SHA256: `72e227d437d2fd2f6ecbbdcd1b39a4a3c290aaaf38175f3e930c8e2cd69846bb`.
- Fixture DLL SHA256: `b0250c77da655f3f0cc50acc34ecebf51a3c6958e01c7fa282c75737d359e4a3`.
- Archive SHA256: `f7daa7417a7004f01099b4ca6c43cea78ee980f82c0d5f916ddbd3d759592fd0`.
- Replayed operation: `b758fc17-177e-4500-b225-c9400f2e100f`; cancelled operation: `09d713d2-abd7-4355-8c6d-1814127bced2`.

Earlier attempts preserved separate logs: Windows-hosted server directory fsync refused with EPERM (no durability weakening); fixture ACL used the wrong environment domain; rooted ZIP asset assertion was corrected; coordinator read-only HTTP polling recovered a stale keepalive connection. These are not counted as passing runs.

## Reproduction

`TEXTTEXT_DOTNET=/opt/homebrew/bin/dotnet node sync/native-folder-case-http.mjs` runs the portable transport-only proof. Actual Windows observer proof uses `--pc-client`, an explicitly owned fresh PC source snapshot, and the validated private LAN marker/token contract in `scripts/vault-http-test-server.ts`. It creates no persistent jobs, accounts, keys or tunnels and does not alter the installed application.

The opt-in LAN fixture binds only an explicitly pinned current private interface and requires a regular isolated ownership marker and per-run token digest; default loopback behavior is unchanged. Tokens are never command arguments or receipt values. Final server TypeScript check passes: `/private/tmp/texttext-native-folder-http-lan-typecheck-20261018.log`; default loopback regression passes: `/private/tmp/texttext-folder-case-real-http-bind-loopback-20261018.log`.
