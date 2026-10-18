# Mac retained window close runner preparation, 2026-10-18

Scope: source and bounded fixture verification. No installed app changes, new
accounts, candidate builds or six-client physical campaigns occurred.

The Mac actor serves close-probe and window-reopen in addition to its prior
hello/prepare/edit/observe/transport/shutdown commands. Normal close uses only
NSWindow.performClose, waits for actual willClose plus hidden state, rejects a
Keep editing sheet, and checks the production controller's typed shared durable
receipt against the configured item/workspace. Its own accepted marker must be
present exactly once in actual visible text and in the fixture pack after close.
Receipt fields contain the operation ID, occurrence count, file hash and bounded
durability identity, not document text or raw account identifiers.

Production Command-W retains the controller, WebView and native editing session.
Reopening uses controller.present and requires the same original mounted editor
and session. Process/mailbox generation remains1; windowGeneration becomes2 only
after the observed closed-to-visible cycle. Actual source/principal/root identity
is reattested. Python's crash restart command is not used. The Mac close receipt
does not set the actor's cached final flush result; shutdown must flush again.

The coordinator reuses the prior observed peer typing overlap contract. A later
real visible browser chunk acknowledgment must arrive while the normal close
request is pending; too-fast close fails insufficient observed overlap. This is
coordinator-observed timing, not a synchronized native/input trace. All accepted
own/peer intents, complete document/assets convergence, and independent fresh-run
reopen remain required with exact scenario and artifact pins.

Evidence:

- Full runner: `/private/tmp/texttext-mac-close-js-full-20261018.log`, 150 passed.
- Final current actorflag compile and three native fixtures:
  `/private/tmp/texttext-folder-case-focused-second-20261018.log`, three passed.
- Earlier production guard and typed-receipt regressions:
  `/private/tmp/texttext-mac-close-native-fixture-20261018.log`, two passed in
  addition to the three isolated actor fixtures.

The isolated native fixture uses real
NSWindow/WKWebView and the production guard with a controlled renderer receipt;
it is not an authenticated TextText or six-client physical result. It checks
pending flush keeps the window available, successful close/reopen retains the
actual window/view/JS lifetime, and wrong fixture durability refuses acceptance.

Remaining: physical rotation for each native close role and browser traffic role,
fresh-process independent reopen, browser close, transport-fault combinations,
forced dirty-journal timing, and the remaining lifecycle/permissions matrix.
