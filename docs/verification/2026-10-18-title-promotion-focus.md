# Title focus across local-to-shared promotion

An isolated production VaultApp/provider fixture reproduced a focus boundary without native AX automation. The title had accepted a trusted keyboard input event, its exact content was saved locally, and its caret was at 28. The fixture then paused all keyboard input while the actual local-to-shared promotion opened its shared baseline. Accepted title content survived, but the new title was not focused and its caret was at zero. A subsequent keyboard character reached no editor field. This proves focus/caret loss; it does not prove already accepted text was discarded or identify the cause of the separate installed zero-input checkpoint anomaly.

The repair captures the actual title selection, including direction, before promotion makes the local editor inert. It carries that target through the shared-baseline wait and restores the bounded title selection when the shared editor becomes ready. The existing guard refuses to steal focus from another active control. Body caret restoration remains on its existing path. No storage, identity, recovery, rendering style, or title-content normalization behavior changed.

## Verification

- Original RED: /private/tmp/texttext-title-promotion-red-20261018.log; retained observation at the owned temporary fixture texttext-title-promotion-ixv1U3/observation.json.
- Three owned Chromium regressions pass: caret 28..28/direction none; selection 24..28/direction backward; and another control focused during the held baseline retains focus and receives the next keyboard character. Title content is exact and the next character reaches the retained title selection in the first two variants. Each browser closes in finally.
- Existing body-promotion and external/unfocused-promotion browser regressions pass, retaining their file/session and focus checks.
- The core manual verifier now requires all three title variants beside its existing body-promotion loop. Its registration regression passes: `node --test sync/verify.test.mjs` (10 tests).
- Relevant unit gate: 77 files, 643 tests pass. TypeScript no-emit without incremental output and diff checks pass.

Commands:

```sh
node --import tsx src/local-vault/__tests__/verify-new-note-title-promotion.mts
node --import tsx src/local-vault/__tests__/verify-new-note-title-promotion.mts --backward-selection
node --import tsx src/local-vault/__tests__/verify-new-note-title-promotion.mts --focus-elsewhere
node --import tsx src/local-vault/__tests__/verify-new-note-promotion.mts
node --import tsx src/local-vault/__tests__/verify-new-note-promotion.mts --external-file --unfocused-promotion
npx vitest run src/local-vault src/lib/documents src/lib/__tests__/markdown-files.test.ts src/lib/__tests__/markdown-files.adversarial.test.ts src/lib/vault/collaboration.test.ts
npx tsc --noEmit --incremental false
```

Private logs: /private/tmp/texttext-title-promotion-{caret,selection,nonsteal}-green-20261018.log, texttext-title-promotion-{body,unfocused}-regression-20261018.log, texttext-title-focus-relevant-20261018.log and texttext-title-focus-tsc-20261018.log. Exact six source/gate hashes: /private/tmp/texttext-title-focus-final-source-20261018.json. Fixture observations remain in the fresh owned directories named by their logs. These are controlled Chromium/local-provider checks, not live account, WK/native AX or six-client acceptance. No owner content was changed by these checks.
