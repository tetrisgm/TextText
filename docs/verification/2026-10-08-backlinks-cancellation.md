# Notes backlink scan cancellation

Shared client source change; installed Mac/Windows and Oracle still use their
previous recorded product sources until the next verified delivery.

Closing Linked from previously left its scan running. A later reopening could
receive stale results or errors from that old scan. The component now invalidates
closed, superseded and unmounted requests, stops before each further batch of
four reads, and applies results/errors only to the current request. Already
in-flight bridge reads finish; no transport cancellation is claimed.

`backlinks-cancellation.browser.mjs` uses controlled asynchronous bridge reads
and the real React component. It covers a stale failure after reopening, a
stale read batch after reopening, prevention of subsequent batches and no reads
after unmount. The original source fails with an unexpected visible error;
the corrected source passes. Baseline log `/tmp/texttext-backlinks-baseline.log`.

TypeScript passed (`/tmp/texttext-backlinks-types.log`). Existing
`reader-rerender.browser.mjs` passed with parse counts 1/1/1 across status and
presence changes. The cancellation regression is in the default reader test
command. Shared desktop UI bundled successfully to
`/tmp/texttext-backlinks-client`. No content, schema, permission or sync protocol was changed.
