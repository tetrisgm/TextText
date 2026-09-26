# Agent runtime sandbox verification, September 25, 2026

This receipt distinguishes runtime feasibility from the complete TextPack
workflow. It does not authorize a release, installation, or App Store submission.

## Installed application inspected

`/Applications/TextText.app` was running version 1.0 (1094), bundle identifier
`app.texttext.mac`, signed with Apple Development, team `52WM463HR2`. Its server
origin was `https://texttext.app`. The signature enabled App Sandbox, outgoing
network connections, and user-selected file access. The bundle had no Codex
helper or source revision attestation. Its exact source commit is unknown.

That installed build cannot run the account-backed in-app agent. Its Store
capability flag is false, and its Store branch returns no runtime. Signing into
TextText does not authenticate the model provider.

## Bounded isolated probe

A temporary test app used an independent container and a copy of the existing
official Codex CLI 0.153.4 executable. Before copying, that executable was signed
by team `2DC432GLL2`. The copy was signed with exactly the sandbox and sandbox
inheritance entitlements. The parent used the same sandbox, outgoing-network,
and user-selected-file restrictions as TextText. It omitted unrelated Apple
sign-in, app-group, and shared-keychain entitlements so no existing TextText
state was accessible. Signing was ad hoc, not App Store distribution signing.

The runtime received an empty, app-owned `CODEX_HOME`. No credentials or config
were imported from Codex, ChatGPT, or another app. Authentication URLs, device
codes, tokens, and private content were not logged.

| Check | Observed result |
| --- | --- |
| Process launch and stdio initialize | Passed |
| `account/read` | Passed; correctly reported signed out |
| `config/read` | Passed; returned an MCP configuration map |
| `thread/start` with `preview_item_type` | Passed; registration only |
| Browser ChatGPT authorization | Failed with JSON-RPC `-32603`: `failed to start login server: Operation not permitted (os error 1)` |
| Documented `chatgptDeviceCode` authorization | Returned verification page and code; explicit cancellation passed |
| App-owned directory after relaunch | Test marker persisted |
| Authenticated model generation and actual tool invocation | Not established by this probe |
| Authenticated session after relaunch | Not established by the marker test |

The failure is specific to the browser flow's local callback listener. It does
not demonstrate that every bundled Store-compatible runtime is prohibited.
The documented device flow starts under the tested restrictions. Authentication
completion, model work, and app integration require separate live verification.

## Source implementation and isolated full app

`CodexEmbeddedRuntime.swift` allows Store code to select only a declared helper
inside its own bundle, with a valid signature and exactly the inherited sandbox
permissions. Store external executable discovery remains compiled out. Bundled
runtimes receive app-owned state and use the documented device flow. The normal
release assembler does not silently add a runtime.

Native connection status becomes ready after an explicit, small, non-mutating
generation check. A successful receipt is bound to origin, workspace, account,
runtime version, and effective model. Later launches can read the account and
receipt without another model request. Confirmed runtime/provider failures clear
the receipt. Explicit disconnection remains disconnected across launch.

Setup cancellation cancels pending login and fences late responses. App exit
stops the owned child without deleting the managed account. Setup requests have
bounded deadlines. Only classified errors and diagnostic identifiers cross the
UI/log boundary; raw stderr stays in bounded memory.

Build a separate full Store-compiled test app manually:

```sh
mac/scripts/build-agent-test-app.sh \
  /Users/shokunin/.local/bin/codex http://localhost:3000
```

The script prints the exact temporary app path. Open that path explicitly. It
uses identifier `app.texttext.agenttest`, a separate container, an explicit
runtime declaration, and the local frontend/backend origin. It neither launches
nor replaces `/Applications/TextText.app`. The production release defaults and
App Store packaging remain unchanged. No development provider override or
unsandboxed helper is required by this path.

The signed test plist also supplies Launch Services environment values
`TEXTTEXT_SERVER` for the explicit local origin and
`TEXTTEXT_DEV_FILEPROVIDER=0`. This outranks any previously linked credential's
origin on reopen and activates the existing guards against writing or clearing
the installed app's File Provider handoff and domain. The test bundle must be
opened through Launch Services using the printed `open -n` command.

The test bundle records `TextTextSourceRevision` and
`TextTextNativeSourceDigest` in its signed Info.plist. The revision identifies
the base commit; the digest covers the current native Swift sources, package
manifest, and source Info.plist, including uncommitted native edits. The local
frontend is served separately and must be identified in the live test receipt.

The focused Store-compiled tests cover protocol framing, numeric request IDs,
conversation separation, timeout progress, helper inheritance restrictions,
authorization URL validation, account/API-key separation, redacted failures,
and readiness receipt scope. These are automated tests, not proof of a real
agent-authored preview, save, or continued authenticated account.

The final native review run passed 26 Codex tests with
`TEXTTEXT_STORE=1 swift test --package-path mac --jobs 4 --filter Codex`.
The separate full app build and strict nested signature check also passed.
The resulting local test artifact is
`/tmp/texttext-agent-test.Upt2ax/TextText Agent Test.app`, with base revision
`d6137d752a714b4f02676378428f0816ba7779e5` and native source digest
`ffa14357c48f72c60d5081c43854b52da84f77529b61067993c102d0cc41d173`.
It targets `http://localhost:3000` and bundles Codex CLI 0.153.4. The native
source was frozen at this handoff for live authorization verification.

## References and remaining gates

- [OpenAI App Server authentication](https://learn.chatgpt.com/docs/app-server)
  documents managed ChatGPT device authorization, cancellation, persistence,
  and refresh.
- [Apple sandbox inheritance](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html)
  documents the parent/child sandbox arrangement.

Packaging a supported runtime in a distributable app, its notices/signing and
App Review acceptance, and the real authenticated TextPack editing loop remain
separate gates. The feasibility probe is not an App Store success claim.
