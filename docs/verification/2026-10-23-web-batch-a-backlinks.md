# Web Batch A: folder move and shared-reader backlinks

Actual live source: `d7a06af43455e205a780615131f955168d034346`. Safari authenticated workspace `be28ae03-c64e-4695-80af-04f048f86f37`; existing private fixture only. Browser verification reference and DESIGN.md were read. No Mac app interaction, deletion, or invalid catalog repair. Original light appearance was restored after the bounded dark pass.

| Existing matrix flow | Actual evidence |
| --- | --- |
| Folder navigation / move | Light opened the prior verification folder and exact body. Dark prepared and reviewed its move from `hase3 A 98b5314a Web Moved` to `Batch A d7a06af4 Web Moved`. [Review](https://texttext.app/proposals/17b4dc71-b393-4ecc-816c-e01551eb8ff6) reported two files, one folder, unchanged contents/access, no added access. Approval returned `Change applied`; destination opened with exact body. |
| Folder presentation / defaults | Dark selected Contact sheet through the actual native select, previewed and clicked Keep folder design. UI then reported `Folder design Contact sheet`; opening its existing note retained exact content. Existing Reading list was observed in light before the change. No item-default control appeared in the inspected folder-design panel or design-file editor; item-default acceptance remains open. |
| Navigation, close and quit | Dark closed only the verification tab normally and opened a fresh workspace tab. It restored the moved fixture and exact body. Other owner tabs were preserved. |
| Backlinks | FAIL: real shared note reader had no Linked from button, including the existing Web241 acceptance note and moved fixture. No backlink success is inferred from local/native behavior. |

Exact moved fixture title: `Batch A folder fixture 98b5314a`. Body remained:

> Private batch A folder fixture. Preserve this exact body through folder move and normal reopen.

These are interaction/DOM results, not screenshot-based visual contrast acceptance. The verification workspace is now Safari tab 25 of window 27380; move and feed review tabs remain retained.

## Focused correction, not yet shipped

`CollaborativeVaultEditor` omitted the identity and navigation callbacks passed by the local reader to `VaultNoteDisplay`. The latter only renders `VaultCardBacklinks` when both identity and path navigation are available. The shared reader now supplies its bound `config.itemId`, source-path navigation, and identity resolution through the existing workspace bridge. No styles or theme colors changed.

`shared-note-backlinks.browser.mjs` mounts the actual shared editor, session and note reader with a fixture workspace transport. On the Mac, the original reader failed at the missing Linked from button; corrected code passes opening the real backlink region, finding a source card, source-path navigation, and inline card identity resolution. The test is included in the existing long-note-reader browser gate. Mac focused browser regression, VaultNoteDisplay tests (2), and TypeScript check pass. Installed/live acceptance of this correction awaits the next batch release; controlled-browser results are not substituted for it.
