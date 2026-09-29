# Browser sign-in in the sandbox, September 28, 2026

The installed Store-shaped WIP build 1096 used Codex's device-code flow. It opened Safari on a nine-character code form without entering the code. The code in TextText had no copy button. This blocked a normal in-app agent connection.

The earlier [sandbox receipt](agent-runtime-sandbox-verification-2026-09-25.md) recorded that Codex's browser flow failed to start its local callback listener when the app had only outgoing-network permission. A bounded ad-hoc probe on the same Mac launched the official Codex CLI 0.153.4 as a signed sandbox-inheriting helper with a fresh private profile. With only `network.client`, `account/login/start` returned an error. With the parent app also carrying `com.apple.security.network.server`, the same browser request returned a validated authorization URL and login ID; `account/login/cancel` succeeded. The probe did not submit an authorization or import credentials.

The Store entitlement now includes `network.server` and the bundled runtime requests the documented `chatgpt` browser login. The embedded helper retains only sandbox inheritance, without an independent server entitlement. The isolated full test app was rebuilt with the same parent permission. Focused Store-compiled Codex tests passed 28/28 (`/tmp/texttext-browser-auth-native-test.log`). The local Store-shaped build 1097 passed strict nested-signature verification (`/tmp/texttext-browser-auth-1097-build.log`) and was installed at `/Applications/TextText.app`; 1096 is recoverable in Trash.

In the installed 1097 UI, Continue with ChatGPT opened Safari directly on **Sign in to Codex with ChatGPT**, showing the signed-in personal account and a Continue consent action. No device-code page appeared. After the owner completed consent, TextText returned to its normal Chat with Codex composer. A read-only request on the selected local test note asked for its exact `Typing` marker line. The real OpenAI-backed agent returned `Typing7d924acf:abcdefghijklmnopqrstuvwxyz0123`, and the document body still contained that same line.

Next, the installed agent was asked to append exactly `Installed browser sign-in verification 2026-09-28.` to that task-created note while preserving its title and prior body. The native editor displayed the appended sentence, the agent reported completion, and a fresh store read by item ID confirmed the original marker and appended sentence were both saved with the same title. The note still showed the sentence after returning to its folder and reopening it.

The installed app was then quit and relaunched once. It briefly showed “Checking assistant access” before returning to Chat with Codex without Safari, a device code, or another sign-in. The edited test note remained visible in the library. This proves one installed-profile reconnect, not a repeated cold-launch timing or agent-active collaboration check. App Store approval remains untested. No public deployment or release changed.

References: [Codex App Server authentication](https://learn.chatgpt.com/docs/app-server), [Apple App Sandbox network server entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.network.server).

## September 29 delayed completion after Cancel setup

A copy of the retained source-`cfa43626` Store-shaped test app was given a
separate sandbox bundle ID and empty profile. It used the local production
web build on port 3131 and the existing local `visual-demo` test account.
No installed app, prior agent profile, or production data was changed.

In native Settings, **Continue with ChatGPT** opened the normal browser
account chooser. **Cancel setup** was pressed before completing that browser
flow, and the native control returned to **Continue with ChatGPT**. The
already-open browser flow was then completed using the existing ChatGPT
account. Its callback could no longer reach the canceled local listener,
which is the expected browser-side outcome for this ordering. The native
app still showed **Continue with ChatGPT**; no bundled Codex helper remained.
After quitting and reopening the same isolated app, Settings again showed
**Continue with ChatGPT**. Thus this late browser completion did not
silently reconnect or reverse cancellation.

This is one live cancel-before-browser-completion ordering. It does not
inject every delayed App Server response, prove all restart races, or test
the current installed build 1113. The isolated app was quit, its temporary
server stopped, and port 3131 was free. The installed app and its local
development server remained running. No authorization code or callback URL
is stored in this receipt.
