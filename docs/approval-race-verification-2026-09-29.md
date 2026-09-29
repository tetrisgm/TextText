# Approval-time human edit, 2026-09-29

This local test used installed TextText 0.202 (1113) and a separate signed-in
browser session against the same `visual-demo` workspace. Both sessions used
the existing owner account. The private `Typing benchmark 7d924acf` note was
the only target.

In the browser, a real Anthropic rewrite of the note's first sentence reached
**Ready**. I clicked **Accept** and temporarily paused its outgoing
`POST /api/ai/tools` before the server received it. While that approval was
pending, the Mac editor replaced the exact selected sentence with `Human
approval race 5e18c4a2.` and showed **Saved**. I then released the request.
The server returned HTTP 409 for the guarded text edit. The browser showed
**The passage changed**, removed **Accept**, and left **Discard** available.
A local canonical-store read at revision 492650 contained the human sentence
and the original Typing marker. No agent replacement was saved.

I discarded the rejected preview, cleared the temporary browser request
interception, and closed that browser tab. The Mac editor restored the original
first sentence and showed **Saved**. A final canonical-store read at revision
492651 contained that original sentence and marker, with the temporary race
line absent.

This proves the approval-click to server-receipt ordering with a real provider,
two live editors, an actual HTTP command, and the saved document. The paused
request had not yet entered server execution when the human edit landed; it
does not prove every ordering inside an already-running server command.
