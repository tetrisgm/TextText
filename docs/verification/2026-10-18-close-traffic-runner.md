# Normal close during observed peer traffic, 2026-10-18

This slice prepares the runner. No Windows native actor journey, installed-app
change, candidate build, deployment or physical six-client acceptance occurred.

Supported scope: one pc-app normal close, one mac-web or pc-web sustained actual
keyboard operation, and four other ordinary peers. The target accepts its own
edit first; five peers then run concurrently. After the first visible browser
chunk the coordinator requests production normal close, requiring another
visible chunk acknowledgment before its successful reply. Fast close fails
insufficient observed overlap. No artificial native flush delay is introduced.
This is coordinator-observed overlap, not clock-synchronized native/input events.

The existing Windows native close implementation is unchanged. Its successful
closed/flushed/no-dialog receipt gates relay shutdown, successful idempotent
flush and confirmed process finish before a fresh generation2. Crash is refused
for an already closed actor; graceful reopen is refused without successful close.
Reattestation pins source, machine, fixture, account and fresh editor lifetime.
All-six full-document/assets convergence and independent reopen preserve each
accepted own/peer intent exactly once. Partial prefixes and uncertain input are
retained as failed operations, never promoted to accepted full operations.

Evidence:

- `/private/tmp/texttext-close-traffic-full-20261018.log`: full runner suite.
- `/private/tmp/texttext-close-traffic-browser-input-20261018.log`: actual Chrome
  trusted Unicode input, detached streaming prefixes and visibility-deadline
  uncertain input. This is a contenteditable driver fixture, not product close.
- `native-close-lifecycle.test.mjs`: bounded mocked lifecycle order/refusals;
  these mocks do not prove real Windows process shutdown.

Missing source support and physical coverage remain for closing other editor
roles, intentionally outstanding dirty native journals at close, close plus
transport faults, and the rest of the lifecycle/permissions matrix. Rotate both
browser traffic roles using fresh coherent source/artifact pins before claiming
this supported physical case. Preserve the existing independent reopen gate.
