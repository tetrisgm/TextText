# Typed protected rename receipts

An additive native HTTP API binds the existing item PATCH result to its immutable operation ID, item, source, destination, base revision and originating account/workspace/server. Ordinary rename callers retain their existing behavior. This is transport preparation; no journal or recovery UI consumes it yet.

Only exact `200 moved` and `409 conflict` schemas produce typed receipts. Moved receipts must match the destination and original content revision. Conflict receipts may report a different safe current server path, a canonical revision or null, and optional JSON `deleted:true`. Unknown/duplicate fields, wrong types, noncanonical hashes, wrong endpoint, unverified account, oversized JSON, generic errors, 412, authentication changes and lost replies remain ambiguous failures. The caller must compare the returned request and scope against its retained command before recording terminal proof. The JSON limit is 16 KiB; Swift URLSession still buffers the HTTP body before checking this limit.

## Evidence

- Meaningful Swift RED: a valid existing response was refused by the unimplemented typed API. `/private/tmp/texttext-protected-rename-swift-red-20261019.log`.
- Final Swift: six tests, no skips, exit zero. `/private/tmp/texttext-protected-rename-swift-final-20261019.log`, SHA256 `8c5f27eac85449236414e29eeddcc125884859514237cbfcf7bcbe6fdcad14e0`.
- Final portable C#: 39 protected receipt assertions and 63 existing ordinary transport assertions, exit zero. `/private/tmp/texttext-protected-rename-csharp-final-20261019.log`, SHA256 `0348f48381d2c18b1f325ae74c9fcb7c6ec5a4c35669fe23b082403795ab7d12`.
- Exact four-source manifest and contract: `/private/tmp/texttext-protected-rename-final-source-20261019.json`, SHA256 `e062d924cafc389080613a61508b4943eae66f57be30f25c629a7667fbde0365`.

No installed product, live profile, account or pending operation changed. Actual PC execution, durable replay integration, explicit terminal-conflict actions and installed acceptance remain separate work.
