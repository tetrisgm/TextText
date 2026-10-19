# Owned comment lifecycle

Actual supported CLI commands against deployed `4eca8353` verified comment creation, idempotent retry and resolution on owned installed-1269 note `8561b2e6-9f49-4420-b4f3-cff9d1f89542` (`Gallery/8.textpack`). The before-list was captured; adding the uniquely marked acceptance comment increased the count by exactly one. Exact retry returned the identical receipt and comment ID `7d24c801-46de-4bd6-8845-f324b3749dba`. Resolve and exact resolve retry also returned identical receipts; a separate final list showed exactly that one comment resolved.

The authenticated author/resolver account matches the existing owner; actor type is `external_agent` and label `codex`. No recipient, sharing or publication operation occurred. Document Markdown stayed byte-identical. The full-pack hash changed as expected because comments are metadata: from `96c0674302da9f1ab74b5699bd1acf8519086540b1188a2f39fc39a581febcd7` to `7b4c6f2b426ec51a50408cb870dd766b4327d0524314bc0ee729f1a0abe28aa9`. The earlier [installed save readback](2026-10-18-mac-1269-installed.md) remains its point-in-time evidence, not the current comment-bearing pack hash.

Create/read/retry/resolve evidence and per-file hashes: `/private/tmp/texttext-owned-comments-1269-20261018/receipt.json`, SHA-256 `a0084aba0135a2e8339732bb2f1721a123d5792643cdbc5390863e105096800c`.

This is a real CLI command workflow, not UI comment parity, an audit-table query, hosted MCP acceptance or complete T19/T20 acceptance. No source, configuration or account changes were made.
