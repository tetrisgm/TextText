# Shared template previews, build 1186

Source `a6fee0e4`: Mac 0.204 (1186) installed at `/Applications/TextText.app`,
Windows installed from the same source, and Oracle serves
`texttext-oracle-20261008T065451Z-a6fee0e4`. No public desktop release.

- Frozen source passed 546 tests in 50 suites, TypeScript and native gate.
  `/tmp/texttext-sync-a6fee0e4.log`.
- Actual browser proposal checks passed: frozen-content preview, stale target
  refusal, exact proposal approval and retry. `/tmp/texttext-preview-a6fee0e4.log`.
- Mac signatures and three extensions passed; normal replacement retained the
  account, iCloud folder and existing agent-created item. Its four headings and
  saved title appeared in the editor and Add agent panel. No prompt was sent.
  Build/install logs: `/tmp/texttext-mac1186-*.log`. The established installer
  runtime-health exception remains unverified; UI startup was checked separately.
- [Windows acceptance](2026-10-07-windows-shared-1186.md).
- Oracle passed thirteen authenticated deployment checks including durable
  retries, audit, restore and old-generation fencing. Previous release retained,
  fresh database backup created, Algorave services active and shared configuration
  unchanged. `/tmp/texttext-oracle-a6fee0e4-deploy.log`.
- Real Safari reopened the same item, with saved title, four headings and
  Mac/Windows presence. Add agent showed the saved title and configured-provider
  requirement; no provider authorization or model execution was performed.

Reuse [1185 dataflow and performance evidence](2026-10-07-shared-templates-performance-1185.md)
for unchanged creation, save/reopen, passive delivery and reader performance.

During the server switch Safari briefly showed its offline banner and then
recovered without Retry. Inspection exposed a further latency issue: the first
automatic recovery read could long-poll for 25 seconds with an unchanged document.
Follow-up `fd0355f0` uses an immediate recovery probe, then resumes normal long
polling. All 54 client tests passed, including recovery without another edit and
return to one long poll. This follow-up is not included in build 1186.
