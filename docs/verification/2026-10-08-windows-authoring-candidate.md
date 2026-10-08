# Windows authored-template candidate

Source `1ae33f20` was transferred as a Git archive into the previously absent
`C:\Users\Shokunin\dev\texttext-client-1ae33f20`. The official embedded Codex
runtime was fetched, then the established explicit Windows build script passed.

Passed: runtime archive regressions, native file/durable-sync suite, native agent
suite, 340 shared-client tests in 38 files, TypeScript, shared UI bundle,
self-contained WPF publish and actual interactive desktop smoke. The smoke
includes failed-flush close preservation and file-activation acknowledgement.
The build reported two NU1510 redundant-package warnings and no errors.

Candidate:
`C:\Users\Shokunin\dev\texttext-client-1ae33f20\windows\build\candidate-babba957a4b243b089077db2f7968f4d`.
Smoke receipts:
`C:\Users\Shokunin\dev\texttext-client-1ae33f20\windows\build\smoke-receipts-21c72d27329441dcb644fa600cb2c631`.
Log: `/tmp/texttext-windows-1ae33f20-build.log`.

Not installed: the existing canonical app remains running with unknown unsaved
state. This candidate does not certify installed account login, actual integrated
model behavior or full platform parity. No persistent build/install job was added.
