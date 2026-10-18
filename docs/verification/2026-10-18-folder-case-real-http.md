# Whole-folder case propagation through real loopback HTTP

T13 bounded engine/native integration, October 18. The existing loopback contract server now has an opt-in `folder-case-moves-v1` capability. Its default remains disabled. Capability changes invalidate its ETag separately from the raw manifest digest. This fixture binds only loopback and uses its existing synthetic token; no production authentication, Next route execution, grant database or live deployment is claimed. Its metadata coordinator is explicitly in memory; separate API/PostgreSQL receipts cover those boundaries.

The Node HTTP test uses actual fetch/socket connections and the production directory engine. It proves complete subtree/empty descendant propagation, exact pack/asset archive bytes, sustained response loss followed by immutable receipt replay, completed recovery taking precedence over cancellation, stale original CAS refusal, reviewed cancellation and denial of a late original request. There is one publication despite retry. Initial test discovery under scripts was refused by the configured test include; the fixture was moved into the existing src test tree without changing test configuration.

The new Mac HTTP contract case uses two real LocalVaultSync actors with actual HTTPLocalVaultSyncTransport and the same server. After both establish physical identity baselines, an ordinary external case rename changes the first tree. Sustained socket-reply loss occurs after the real server move. The first native journal retains its command; a reconstructed actor retries it, and the second native actor pulls the authoritative whole-folder change. Both roots contain only the new spelling, the empty child and exact original archive/asset bytes. Idle passes add no uploads, downloads, file renames, deletion or folder RPC/publication. No per-file rename substitutes for the directory operation.

## Evidence

- Node real HTTP case passes: `/private/tmp/texttext-folder-case-real-http-final-20261018.log`.
- Combined Mac gate passes 139 checks with two existing optional Shared skips and no failures: `/private/tmp/texttext-mac-folder-recovery-combined-20261018.log`. Both actual loopback HTTP contract cases execute, including the unchanged existing two-vault contract and the new folder case. HTTP cases complete in about 3.47 seconds.
- Exact three source hashes: `/private/tmp/texttext-folder-case-real-http-source-20261018.json`.
- All servers and roots belong to newly created isolated fixtures. Their owned process is terminated and their scratch data removed after the checks; no user content, existing process, installed application or job is changed.

The optional one-shot folder race control creates an unrelated fixture-only empty server directory just before the next folder CAS, enabling a real retained-command review in the forthcoming WK bridge fixture. It is not a production hook. Actual Windows Core/HTTP integration, actual new WK recovery bridge, installed apps, six simultaneous clients, real hosted credentials and power-loss behavior remain separate acceptance boundaries.
