# Explicit adoption of unbound retained work

T17 prerequisite brought forward for T07. This describes the transaction being implemented, not completed acceptance.

## Entry and authority

The ordinary native open path refuses unbound queues/checkpoints. The recovery UI must identify the folder and the currently verified account, preserve access to original recovery bytes, and offer an explicit choice to keep that work with this account. It cannot use a token hash or the identity of the next opener as ownership proof. Known foreign ownership is refused even if both actors can edit the server item.

The adoption command captures the verified account, origin, workspace and root. It rechecks authorization and credential lifetime before changing state. Existing workers/editor writers for that root must be retired after their durable barrier. Normal background work stays blocked while an adoption intent exists. The root ownership marker is device-private; portable workspace metadata contains no user identity.

## Durable transaction

1. Read and validate every active state/checkpoint/intent before changing any original. Refuse malformed or future formats, foreign owners, unsafe paths and unsupported records. Keep operation IDs, cursor/lifecycle values, pending updates and pack bytes unchanged.
2. Prepare a new private transaction directory with exact original metadata bytes, intended replacement bytes and hashes. Bound file counts and total size. Do not overwrite another transaction's recovery directory.
3. Publish one versioned adoption intent only after all originals and replacements have been persisted. Bind it to the captured root, origin, workspace and account. A crash before publication changes no original.
4. Before applying, validate all backups/replacements and compare every live target with its recorded original or completed replacement hash. Refuse a divergent current file. Apply replacements atomically, retaining the intent through interruption. Permission caches must not transfer old write grants to a new principal.
5. Verify every replacement, publish the immutable account/root ownership marker and persist a completion receipt. Only then remove the active intent. Retain all backups and the receipt.
6. A retry with the same verified principal resumes the recorded transaction without inventing operation IDs. Another account, invalid intent, corrupt backup or divergent target remains blocked. No automatic clearing or reset repairs an unknown format.

## Compatibility and tests

Native sync state and checkpoint intents now explicitly write version1 while retaining the historical implicit version1 Mac reader path. Embedded collaboration journals require version1. An account label is an enforcement change even when the format version remains readable: older installed binaries must not write adopted state. Final rollback instructions need forward recovery from the retained originals, not a claim that reinstalling an older app is safe.

Exercise interruption during preparation, intent publication, each replacement, ownership publication and completion. Assert exact backup bytes, pending operation identity, projection/asset preservation, blocked ordinary replay, same-owner resumption, wrong-owner refusal, no duplicate adoption on retry, and refusal after external divergence. Browser generic drafts and old WKWebView/WebView2 profiles require their own explicit recovery; a native queue migration does not prove their adoption.

Cross-process exclusion and background host callers remain part of T09/T11/T17 acceptance. A process-local lock is insufficient evidence for that boundary. This transaction must not be installed until its recovery UI and compatibility fixtures pass on both native platforms.
