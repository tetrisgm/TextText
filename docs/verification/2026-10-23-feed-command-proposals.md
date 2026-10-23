# Feed command parity and durable review, 2026-10-23

Status: server code verified locally; live UI/assistant/CLI/MCP acceptance remains pending after the next unified release. Native adapter patches are separate and are not included here.

## Cause and correction

The file-backed UI already stores a feed subscription as a marked bookmark TextPack, but the canonical file command registry omitted `add_feed`. Its inherited descriptor described legacy feed-folder behavior. The legacy in-app assistant also sent this network operation directly through its command transport instead of staging durable owner review.

The shared file command now reuses the existing public-feed resolver and ordinary audited `create_item` mutation. Its title and operation fingerprint depend only on the approved URL, destination, optional name and stable key. Publisher metadata cannot change retry identity. Existing completed receipts avoid another fetch and retain exact snapshot bytes, including after lost audit acknowledgement.

Assistant, signed-in CLI and hosted MCP stage the same frozen URL/destination/name proposal. No publisher request occurs during staging. Approval rechecks the frozen fields and existing permission boundaries. Tampered reviews enter a durable failed state. The selected native workspace can be supplied as `expectedWorkspaceId`; a mismatch fails before insertion. A lost staging response resumes the same proposal using the stable key. Legacy in-app tooling returns the review receipt without falsely refreshing the pool as if a feed had been created.

## Checks

- Prior retained baseline proofs: missing file command discovery failed; original legacy transport and absent workspace check failed two focused tests. These logs are retained in `/private/tmp/texttext-feed-command.Drsrma` (`feed-baseline-red.log`, `assistant-server-red.log`).
- Integrated exact changed files on Mac: eight focused Vitest files, **185 passed**. Includes actual filesystem snapshot/receipt replay, viewer refusal before fetch, portable destination refusal before write/audit, audit acknowledgement recovery, frozen approval/tamper, folder boundary, exact workspace, and lost-stage retry.
- Current PC and fresh archived-source Mac TypeScript checks passed (`tsc --noEmit --incremental false`).
- No real feed, account, server content, installed app, owner pin, conflict record, or journal was changed by these checks.

Final exact archived-source Mac test log: `/private/tmp/texttext-feed-integrated.TunNxi/focused-tests.log` (185 passed). The first scratch typecheck included retained proof files and lacked repository scripts; it was not a valid repository gate. A fresh current-HEAD archive plus the exact changed files passed the final Mac typecheck at `/private/tmp/texttext-feed-integrated.TunNxi/typecheck.log`.

## Remaining delivered checks

After release, exercise a real named-folder feed proposal from the UI assistant, signed-in CLI and hosted MCP: verify exact review details and no premature feed creation, approve once, inspect the subscription and audit, retry without duplication, and quit/reopen with exact content. Native Mac/Windows adapters need their own integration checks before advertising this capability. No simulated check above counts as installed acceptance.
