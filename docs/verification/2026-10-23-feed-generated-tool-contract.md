# Generated feed tool contract, 2026-10-23

The 644deafd release stopped at the generated-tool documentation gate: adding the file-backed feed command updated its registry but not the generated hosted catalog. The earlier focused feature tests did not include this gate.

Ran the prescribed generator in an isolated copy of exact 644deafd on the Mac: `npx tsx scripts/sync-tool-docs.ts`. Only `docs/mcp.md` and `scripts/generated/mcp-tool-contract.json` changed. They add `add_feed` to hosted tools/open-world membership, update hosted counts from 27 to 28 (19 to 20 sync tools), and include the existing file-backed feed descriptor. The shared 52-tool architecture block is unchanged. No product source or release guard changed.

The generated output passed `npx tsx scripts/sync-tool-docs.ts --check` on Mac and PC. The actual Mac checkout also passed `npx tsx scripts/verify-docs.ts` (555 docs, 237 scripts, 12 archived). The PC verifier reported six existing Mac-only artifact/archive references; these were not changed. The Mac owner pin and unrelated files were preserved. Mac source copy: `/private/tmp/texttext-tool-docs.RxQg1D`. This corrects the release prerequisite; it does not claim delivery or installed feed acceptance.
