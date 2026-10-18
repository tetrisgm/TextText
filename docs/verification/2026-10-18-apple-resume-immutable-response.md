# Apple callback immutable response repair

## Observed production failure

Read-only `texttext.service` journal inspection of the preceding 20 minutes found
`TypeError: immutable` at `1792355818069465` (UTC microseconds). The deployed source
was `f994b8f1eee9ff6615856916f180001dc23a00ba`, deployment
`texttext-oracle-20261018T174659Z-f994b8f`. Its compiled callback's header mutation
at line 1, column 12862 matches the stack location at column 12870.

The immediately preceding Auth.js rejection was `InvalidCheck`, with the known
message `state value could not be parsed`. The immutable-header exception masks
that error response. This repair does not establish successful Apple sign-in or
explain why that attempt's state could not be parsed. A fresh real sign-in still
requires verification after an authorized deployment.

Only allowlisted error labels, timestamps, and compiled source locations were
emitted. No callback payloads, cookies, tokens, account content, or raw auth logs
were saved. No server configuration, service, database, or deployment changed.

## Change

Wrap the Auth.js result in a fresh Web Response with copied Headers, retaining
its body, status, status text, redirect location, and separate Set-Cookie values.
Apply no-store and no-referrer to that response. The original immutable response
is left untouched. Origin, bounded form, state, and cookie protections are unchanged.

## Verification

- RED: an actual `Response.redirect` reproduced `TypeError: immutable` at the
  same source mutation; 1 failed, 9 passed.
- GREEN: all 10 focused tests passed, including immutable redirect, separate
  cookies for redirect/error statuses, body and metadata preservation, existing
  canonical request form/cookies and rejected origins.
- `npx tsc --noEmit --incremental false`: exit 0.

Private logs:
`/private/tmp/texttext-apple-resume-immutable-{red,green,tsc}-20261018.log`.
These are local unit/type checks, not a live authentication acceptance result.
