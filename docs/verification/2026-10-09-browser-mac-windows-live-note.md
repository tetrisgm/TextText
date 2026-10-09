# Browser edit to Mac and Windows TextPacks

October 9, source `06c3ad60` installed on Mac build 1242 and Windows, with
Oracle serving that source. In the signed-in production browser, edited
`Notes/Untitled 16.textpack` while the installed Mac app showed the same
note. The browser added `Browser edit check 1242.` to the note body. Before
clicking Finish, the open Mac reader showed the new sentence. Finish returned
to the reader without a recovery warning.

The Mac's selected iCloud TextPack and the Windows TextPack at
`C:\Users\Shokunin\TextText\be28ae03-c64e-4695-80af-04f048f86f37\Notes\Untitled 16.textpack`
both contained the exact sentence. Extracted `Document.textbundle/text.md`
had the same SHA-256 on both machines:
`7feba52cfda107b71226943210e2cfa3505dd5e5a9e521228f449ea62e732969`.
ZIP hashes differed because ZIP metadata is not canonicalized.

This proves one live browser-to-open-Mac edit and Windows file catch-up.
The Windows app was open on another note; this does not prove that its editor
displayed this edit, nor the full six-client acceptance contract.
