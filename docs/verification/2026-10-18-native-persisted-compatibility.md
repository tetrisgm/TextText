# Native persisted compatibility and rollback limits

T17 inventory, October 18, 2026. This receipt distinguishes actual historical source from the newer intermediate readers characterized by existing migration tests. It is not an installed-binary or complete mixed-version acceptance result.

## Reader generations

| Reader/source | New protected state | Evidence / supported use |
| --- | --- | --- |
| Reported installed Windows source `65417abddb0e7efba9206d04dd0adbbbaa15a2d9` | Has no `AccountRootOwnership.cs` or `RetainedReplacementProfile.cs`. `TextPackStore` creates root/state and checks links; ordinary read/write never inspect these later metadata floors. | Historical source audit and isolated harness below. **Not a safe rollback writer** on an upgraded root. The exact installed binary is not executed by this gate. |
| Reported installed Mac source `0a5bbd15f05081aca6402eda61f87d61d1984f53` | Has no corresponding account owner/profile implementation. Store init canonicalizes root; ordinary writes use `replaceItemAt`. | Source audit only. No old Mac build/runtime test; refusal is not established. Treat as an incompatible rollback writer. |
| Intermediate account-owner-v1 readers | Known account factory rejects unsupported owner-v2; intermediate protected-profile-v1 reader rejects profile-v2 before directory case mutation. | Existing native profile migration/refusal fixtures. These results do **not** imply the actual older installed sources have these guards. |
| Current candidate source | Reads verified owner-v1 or owner-v2; protected profile-v1/v2/v3 must match principal/root/original-owner bytes. New protected saves publish the owner-v2 floor; directory case operations require at least profile-v2 and automatic whole-folder propagation publishes profile-v3 while preserving the verified earlier profiles. | Current native profile/folder tests, [folder reconciliation](2026-10-18-folder-case-reconciliation.md), [parent/profile reads](2026-10-18-parent-path-and-profile-reads.md). Final candidate build/source identity remains a separate gate. |

Owner/profile floors are device-private compatibility guards for supported readers. They cannot prevent historical apps that never read them, external editors, or another device's older writer from changing synchronized files. Keeping the old app installed alongside the candidate is not proof of safe mixed-version operation.

## Persisted format inventory

| Format | Current reader/writer contract | Upgrade / rollback constraint |
| --- | --- | --- |
| Portable TextPack `DocumentSnapshot` | Validated schema-v1; native private recovery changes do not change portable document schema. | Readable document bytes alone do not establish compatibility with native pending edits or recovery state. |
| Native account owner | Owner-v1/v2, verified origin/workspace/account/root; v2 verified through protected profile. | Original owner-v1 bytes preserved. Do not hand-edit/downgrade marker to make an old writer open. |
| Protected replacement profile | Marker-v1/v2/v3, ownerVersion2, principal hash and original-owner hash. v2 requires preserved `profile-v1.json`; v3 also requires the exact preserved profile-v2 chain. | Publish/interrupt/reopen validation in native tests. Supported v1 readers refuse v2, and supported v2 readers refuse v3; actual historical installed readers may ignore it entirely. |
| Retained replacement/removal/move manifests and workspace registry | Version1 plus strictly allowlisted operation/mode/consent fields, root/principal/path/identity/hash scope. Legacy identity mode and nested receipt additions change accepted field shape despite version remaining1. | Unknown fields/modes fail closed in supported readers; preserve all retained bytes and journals. No blanket same-version compatibility claim. |
| Directory case journal | Version1, scoped endpoints, inode identities and exact inspection consent; protected profile-v2 or v3 required. | New feature has no historical reader support. Do not resume an old app while unresolved. |
| Automatic whole-folder case command | Version1, immutable original complete subtree, exact physical source identity, root/account binding and server request/receipt. Profile-v3 gates supported earlier readers. | Preserve the pending command, baseline and reviewed cancellation receipt. HTTP errors do not prove non-publication. [Server recovery](2026-10-18-folder-case-command-recovery.md); native recovery integration remains under verification. |
| Native background sync state/outbox | Version1 (Mac additionally accepts legacy missing version), account binding; pending operation IDs/payloads retained. | Current queue tests preserve FIFO/IDs/payloads through restart. This is not a historical app migration campaign. |
| Native shared-edit checkpoints and intents | Version1 (Mac permits legacy missing version), validates embedded shared journal version1, epoch, seq, generation, path and acknowledged revision. | Pending drafts remain device-private; copy/swap of just visible packs does not migrate them. Unknown future state must not be cleared. |
| Browser pending journal | Existing pending fixture migrates localStorage fallback into actual IndexedDB transaction. | Abort preserves fallback and operation identity; fresh page recovers. [Chromium/WebKit receipt](2026-10-18-browser-journal-compatibility.md). Installed Safari/WKWebView and cross-app version migration remain separate. |

The two native platforms have distinct private JSON field spellings and layouts. Do not copy one device's state directory to another as a migration method.

## Isolated historical Windows source gate

Human-invoked command: `node sync/historical-native-reader.mjs` (optional `TEXTTEXT_DOTNET` selects an existing SDK executable).

The gate extracts exactly commit `65417abd` Core sources from git into a fresh OS scratch directory, without editing them. A separate producer executable uses a copied/hash-pinned current Core snapshot to create an empty owned root with production `AccountRootOwnership.Open`, a full schema-v1 document derived from the production `emptyDocumentSnapshot`, `TextPackStore.Write`, and actual protected-profile publication. The internal production `PrepareFolderCase` is invoked by reflection only to publish the profile-v2 compatibility floor without performing a directory rename. Its current factory/profile verifier and `Describe` accept the exact resulting root before historical access.

The separately built historical executable then reads and writes that exact root/state. Its update changes body in both text.md and canonical document.json through the historical `WithDocument`, preserving the full schema. It checks every existing private metadata file's exact hash before/after its write. A temporary unknown future owner is likewise ignored by the historical reader and the original owner bytes are restored in `finally`. The current executable then reopens the same root/profile and reads the historical changed text and canonical body successfully. **A valid external edit does not disclose that an unsupported historical app wrote it; the current reader does not detect that writer provenance from these bytes alone.** No pending recovery conflict was manufactured or suppressed.

Strengthened gate passed on Darwin with the existing .NET SDK: `/private/tmp/texttext-historical-native-reader-production-20261018.log`. Exact current Core input hashes and retained scratch path are printed in the log and stored in scratch `current-source-hashes.json`. Harness SHA-256: `f610aa3057d348fc2b13c96edc7260e33ebe7825e0eee508bb9f7a85c02e463a`.

This Windows product Core source is executed on Darwin, not an installed Windows process or Windows filesystem gate. The earlier `/private/tmp/texttext-historical-native-reader-20261018.log` characterized synthetic marker files and a minimal pack only; it is superseded for the real production-profile upgrade boundary by the strengthened gate. Initial environment-only attempts were corrected without modifying historical source. All workspace/state/build outputs are disposable newly created scratch; no user content or installed app was opened.

This is a **negative compatibility characterization**: success means the old writer bypasses the new guard. It is not a candidate migration/acceptance pass.

## Forward recovery instructions

1. Preserve the complete synchronized workspace and each affected device's private state, including pending outboxes/checkpoints, ownership/profile originals, recovery registries and retained files. Record hashes and source/build identities before changing binaries.
2. Stop ordinary use of incompatible historical TextText writers on that root before the candidate writes protected state. Upgrade every native writer that will access it; browser/server compatibility is a separate version gate.
3. Close the current app normally only when its actual durability receipt succeeds. If save/close refuses, retain the process and recover/export through the compatible app; do not force a binary rollback to bypass the refusal.
4. Recover unresolved operations with the current compatible app's scoped Recovery UI. An inspection digest that changed must be reread; preserve both alternatives. Never clear unknown metadata, rewrite version numbers, or overwrite retained bytes to regain access.
5. After protected candidate state exists, prefer a fixed forward build that understands that state. A binary-only rollback to either reported installed source is unsupported. A pre-upgrade backup is evidence/recovery input, not permission to overwrite newer visible documents or erase pending edits. Restoring a complete matched backup requires explicit review of all newer changes and authorization.

## Remaining gates

Actual old Mac runtime behavior, current-on-historical pending native journal upgrades, interruption at every remaining migration write, and sustained supported mixed-version operation are not established by this inventory. Do not mark full T17 complete from the historical characterization or intermediate-reader refusal tests.
