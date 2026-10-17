# Shared visual baseline

October 17 source work following `f5198687`, requested in parallel with multiplayer completion. Not installed or deployed; T19's full interaction matrix remains open.

## Changes

The web, Mac and Windows entry points already mount `VaultApp`. Its stylesheet now supplies an explicit 14px/1.45 shell baseline instead of inheriting different host defaults. Header actions, sidebar disclosure, keyboard focus, selects and light/dark colors share that baseline. Explicit appearance overrides the OS preference consistently; reader surfaces inherit the resolved palette. Touch header/disclosure targets remain 44px. Document template typography, native display scaling and browser zoom remain intact.

Windows now packages the existing Mac brand PNGs at five sizes in its icon. Its native controls load WPF's system theme dictionary; standard window backdrop behavior is retained. Microsoft documents [system light/dark and high-contrast support](https://raw.githubusercontent.com/dotnet/wpf/main/Documentation/docs/using-fluent.md), and identifies this Fluent integration as experimental. Native dictionary/style loading passed actual PC smoke. Full installed titlebar/dialog/high-contrast visual acceptance is still open.

## Rendered evidence

All comparisons use the production shared component with an isolated read-only fixture transport. They do not access personal content. At a real 1200×800 CSS viewport, native and web-global stylesheet profiles agree on 14px shell/control text, 20.3px line height, 34px header actions, 240px sidebar, theme colors and no horizontal overflow. OS font rasterization intentionally remains platform-native.

| Runtime | Passing evidence |
| --- | --- |
| Chromium | `node src/local-vault/__tests__/visual-parity.browser.mjs`; native defaults, website global styles and an inherited 22px host default, light/dark, explicit theme overrides, narrow layout, keyboard folder controls and coarse-pointer targets. Screenshots and `receipt.json`: `/private/tmp/texttext-visual-parity-fixture` |
| Actual WKWebView | `LocalVaultVisualParityTests.testSharedShellInActualWKWebView`, log `/private/tmp/texttext-visual-wk-retry.log`; four native/web × light/dark screenshots and metrics under `/private/tmp/wk-visual-parity-E08BBD4A-5E9C-4DC5-BDC7-16EF5BA85A1B` |
| Actual PC WebView2 | Focused visual smoke exit 0, `/private/tmp/texttext-visual-pc.log`; four screenshots and metrics copied to `/private/tmp/texttext-visual-pc-receipt`. Remote receipt `windows/build/visual-parity-smoke-20261017/webview2-visual-parity-3d53cb43-7204-4501-9324-9960be7d160b` |

The screenshots were visually inspected. The 22px inherited-default before image reproduces oversized controls; the shared baseline removes that drift. Existing `document-layout.browser.mjs` also passed List/Cards persistence, scope isolation, no-write, light/dark and narrow-layout checks. `node windows/scripts/build-icon.mjs --check` confirms the icon contains the exact existing artwork bytes.

The first WK visual fixture waited indefinitely for animation frames in a throttled page and was stopped. The fixture now uses bounded native readiness, theme-settling and snapshot callbacks; all original metric assertions remain. Failed log `/private/tmp/texttext-visual-wk.log`; the corrected test passed in 1.457 seconds. `Package.resolved` was preserved.

The complete Windows desktop suite with production appearance passed separately: `/private/tmp/texttext-t11-production-pc-smoke-retry.log`. The focused visual run is not represented as that full suite. No public release, personal account change or installed parity claim follows from these fixture results.
