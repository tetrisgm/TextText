# Windows desktop save and restart

October 9, installed Windows source `06c3ad60`, workspace
`be28ae03-c64e-4695-80af-04f048f86f37`, item
`87622f2f-0056-42f3-ade3-bd932ce11250`. The one-shot interactive desktop
acceptance runner used the production `MainWindow` and `WindowsBridge` with
the saved sign-in. It inserted `[pc-app:restart1242e:00]` in the live editor,
kept the original editor mounted, flushed successfully, and verified the
marker exactly once in the visible body and saved TextPack.

A separate interactive desktop process then reopened the same file with the
new verify-only runner mode. Its reader showed the marker exactly once, no
recovery or error notice, and the saved TextPack retained the same item ID and
ZIP SHA-256 `baaf5a90852a7b44dee8ae3abd76664cf4679d10cd6bead859a4b671a34dea5c`.
The selected Mac TextPack also contained the new marker exactly once. The
normal installed Windows app was restarted afterward and its interactive
window was responsive.

PC receipts are `C:\Users\Shokunin\dev\texttext-win-restart1242e-receipts`
and `C:\Users\Shokunin\dev\texttext-win-restart1242e-reopen-receipts`.
Two preceding verify-only attempts were test-launch failures: a direct SSH
process had no interactive WebView2 window, and the initial verify-only runner
left its read-only window open after recording success. The one-shot launcher
and explicit read-only close fixed those harness issues. This round does not
cover pending-edit recovery or simultaneous six-client restart.
