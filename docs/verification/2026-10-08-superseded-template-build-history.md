# Superseded template build history

Historical checkpoint only. Current delivery is recorded in HANDOFF.md.

- Earlier Oracle template package used clean source `223954b8`.
  It is superseded and must not be deployed as the current candidate. Its core gates passed
  (837 tests, 87 files), native sync gates passed, and the production web
  build and immutable packaging completed successfully. Logs:
  `/tmp/texttext-oracle-template-gates.log`,
  `/tmp/texttext-template-native-gates.log`,
  `/tmp/texttext-oracle-template-build.log`, `/tmp/texttext-template-package.log`.
  Full required release checks first stopped at stale generated MCP docs
  (`99704` terminal), then historical handoff links and temporary fixture
  paths (`98957` terminal). Both failures are corrected in `3e01429e` and
  `b403c984`; docs verification and all seven sync-verifier regressions pass.
  The clean clone is `b403c984`; full release verification stopped at the
  stale MCP live-client contract (`14624` terminal), log
  `/tmp/texttext-template-release-gates-links-fixed.log`. The corrective source
  now generates the hosted 27-tool catalog from the actual vault registry,
  checks OAuth resource discovery, and gives local evaluation disposable file
  storage. Actual MCP discovery/catalog/resources/prompts/revocation/replacement
  acceptance passed; `/tmp/texttext-mcp-discovery-live-check.log`. TypeScript,
  docs verification and generated-doc checks passed. Update the clean candidate,
  then resume full release checks. Revalidate sync receipts and rebuild/package the exact
  new candidate source before deployment; the existing archive is older.
  Oracle remains on `cce4206c`, unchanged. Preflight
  verified 27 GB free, recent backups and all TextText/Algorave services active.
  Candidate archive:
  `.texttext/oracle/texttext-223954b8-templates.tar.gz` in that clean clone.

