# Canonical template remix

Source: `626ee884`. Source verification only; installed clients remain 1189 and
Oracle remains `43614e64` until the next verified deployment.

`remix_item_type` creates a new template identity at version 1 through the
existing file journal and audit path. Built-ins require an exact version;
custom templates require a pinned source item and hash. Source items and items
already using the source template are unchanged. Private body text and opaque
assets are not copied into the template library.

Authored copies retain their editable blueprint, fields, item and collection
layouts, theme and starter. Renaming recompiles generated example labels and
descriptions from the renamed blueprint. Definitions without authoring source
retain their definition except for identity, version and name.

## Evidence

- `vault-templates`, `vault-tools`, and `write-proposals`: 56 tests passed.
- Final template/tool recheck after authored-definition assertions: 21 passed.
- TypeScript passed. Scoped ESLint: no errors; existing unused
  `customTemplateId` warning in `src/lib/ai/tools.ts`.
- Real temporary TextPack tests cover public dispatch, source/version drift,
  permission revocation, destination authority, unchanged existing items,
  repeated operation keys, and private-content exclusion.
- Hosted approval test simulates a committed file operation whose SQL completion
  response is lost. An expired retry recovers the same artifact; revoked access
  cannot recover it. This does not attest a live model-provider run.

Local logs: `/tmp/texttext-remix-tests.log`,
`/tmp/texttext-remix-final-tests.log`, `/tmp/texttext-remix-tsc.log`, and
`/tmp/texttext-remix-lint.log`.
