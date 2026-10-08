# Windows candidate matching Mac 1208

Frozen source `9a38e556`, same as installed Mac 1208. Actual PC build exited successfully: runtime archive regressions, Core durable-sync tests, Agent item/folder creation/search/cancel/login/process tests, 329 shared-client tests in 38 files, TypeScript, shared UI packaging, self-contained WPF win-x64 publish and native editor/close/file-activation smoke. Receipt sealed.

Candidate: `C:\Users\Shokunin\dev\texttext-client-9a38e556\windows\build\candidate-19d5a1a599354203b4d3dc98947da50c`.
Smoke receipts: `C:\Users\Shokunin\dev\texttext-client-9a38e556\windows\build\smoke-receipts-ff4c508fd8cb4887b1aa36b0e382de3c`.
Log: `/tmp/texttext-windows-9a38e556-build.log`.

Not installed: fresh process query still found installed TextText PID 44968, responding, empty MainWindowTitle, at the canonical installed executable. Its unsaved state is unknown; the earlier save-and-close request remains pending. No forced termination, user content changes or persistent jobs. Temporary smoke WebView directory retained: `C:\Users\Shokunin\AppData\Local\Temp\texttext-desktop-smoke-a0eae2bb-bedb-4293-ab88-e51a697edd74`.

Live model creation and installed-client sync/performance acceptance remain outstanding. Hosted folder authorization remains separate.
