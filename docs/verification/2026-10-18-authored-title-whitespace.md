# Authored title whitespace and collaboration read coherence

The installed Mac new-note observation retained a pending journal after a partial title was acknowledged. Read-only evidence proved the batch was acknowledged and its revision matched the independently read server item. The later local journal and projection were schema-valid. This observation alone did not identify which later request failed or its precise HTTP status.

A controlled local reproduction found a concrete serialization failure: writePayload emitted a JSON-quoted title ending in a space and preserved that exact title in document.json, but the shared Markdown parser trimmed the quoted value. The pair could not receive a coherent projection stamp. The first collaboration update was accepted; the next authoritative checkpoint validation threw VaultRepresentationConflict while reading the authored pack. This is not evidence that the initial edit was rejected by the server.

The fix preserves the parsed title string. Bare frontmatter still trims its raw value before parsing; other metadata normalization is unchanged. No accepted title or Yjs update is trimmed to conceal a mismatch. Fresh writes keep matching Markdown, JSON and projection provenance, and the previously produced whitespace-title pair can again be read coherently.

## Verification

- Before the fix, four roundtrip whitespace-title cases and one actual engine accepted-update/read/continued-edit regression fail: five failures, 27 passes. Afterward the parser/model/engine normal and adversarial tests pass 100 assertions.
- Broader relevant checks pass 77 files and 643 tests. The collaboration route passes 14 tests, including explicit characterization that this exact projection-conflict message currently maps to retryable HTTP 503, not an invented 422. TypeScript no-emit without incremental output passes.
- A separate controlled actual FileCollaborationClient run held the first acknowledgement while further title/body/tag edits were made. Old parser: first update accepted, next read conflicts, pending retained. Fixed parser: two accepted batches, three successful reads, seq2, flush true and no pending changes. The temporary diagnostic assigned 422 only to demonstrate the generic retirement UI; that assigned status is not an actual route observation. Separate preserved red and green bundles/results retain this limitation.

Private evidence: /private/tmp/texttext-title-whitespace-{red,green,relevant,route,tsc}-20261018.log and /private/tmp/texttext-1264-newnote-rejection-20261018/{title-fix-source.json,rapid-client-red-result.json,rapid-client-green-result.json}. No production database, live replay, account marker or content mutation was used for these reductions. Installed/live acceptance remains separate from these source checks.
