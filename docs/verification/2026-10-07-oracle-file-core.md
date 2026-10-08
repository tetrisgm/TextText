# Oracle canonical file deployment acceptance

- Source: `4a7ecb09c6ca1a272ad2050122f1575a0c83c0d7`.
- Live: `texttext-oracle-20261008T034937Z-4a7ecb0`.
- Backup: `texttext-20261008T035035Z-16dd5697.dump`; previous release retained.
- Log: `/tmp/texttext-4a7ecb09-deploy.log`.

## Verification

Exact-source sync core: 289 passing tests; native gates passed. Client source
is unchanged from installed Mac 1181 and Windows `116d3dde`.

All nine production smoke checks passed: authenticated session, mutation origin
enforcement, workspace read, create/read, edit/durable retry/read, native search,
native capture receipt, canonical file storage/audit and scratch cleanup.
The regression suite decodes generated responses with production Swift models.

Actual Safari navigated to `/@ramine` and redirected to the canonical workspace.
The signed-in account, List/Cards controls and 16 existing items appeared.
Opening the dedicated Windows sync verification note showed all ten markers,
including the Mac 1181 edit, and both Mac and Windows participants. No content
was changed during browser acceptance.

Post-deploy TextText and all three Algorave services are active. HAProxy and
runtime configuration mtimes are unchanged. No public desktop release occurred.

## Limits

This verifies this deployment and the recorded sync scenarios, not every future
failure mode. Remaining agent capabilities and physical-device tests are tracked
in `../HANDOFF.md` and `../agent-file-backend.md`.
