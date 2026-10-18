# Browser journal compatibility in Chromium and WebKit

October 18, 2026. Bounded T17/T18 evidence using an isolated Playwright browser context and the production FileCollaborationClient/default browser journal store. No product persistence code changed. No hosted requests, production browser profile, native installation or deployment was used.

`node sync/browser-journal-compatibility.browser.mjs` passes against real IndexedDB and localStorage. It seeds the existing version-1 pending fixture, then aborts the actual migration transaction after its put succeeds but before commit. The client refuses durability, makes zero requests, keeps the exact localStorage fallback and leaves no committed row. A fresh page/module recovers the complete pending body and original batch operation ID, reports durable only after a real transaction, and survives another fresh-page reopen.

After ending the producer, the test seeds an unsupported IndexedDB row schema. Default browser ownership refuses it before journal acquisition; the client reports error, grants no durability and makes zero requests. The row remains exactly unchanged. This startup refusal need not set the later journal-parser unreadable flag. The fixture observes Yjs state without creating missing types: calling the mutating documentText accessor on a refused empty document would itself produce a spurious edit and obscure the original error.

The same fixture also passes with `node sync/browser-journal-compatibility.browser.mjs webkit` on the Mac against actual Playwright WebKit. Transcript: `/private/tmp/texttext-browser-journal-compatibility-webkit-20261018.log`.

The default Chromium check is included in manually invoked core/client sync verification and source fingerprints already include its `sync` directory. Transcript: `/private/tmp/texttext-browser-journal-compatibility-20261018.log`. Gate helper tests: `/private/tmp/texttext-browser-journal-gate-tests-20261018.log`. Existing collaboration/compatibility unit regressions: `/private/tmp/texttext-browser-journal-compatibility-unit-20261018.log`.

This covers transaction abort and page/module reconstruction in Chromium and Playwright WebKit. It does not claim browser-process kill, machine power loss, installed Safari/WKWebView integration, all browser engines, native journal upgrades or complete T17 acceptance.
