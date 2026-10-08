# Live Mac, web and direct file round trip

Installed Mac: 0.204 (1202), source c58114ad.
Live Oracle: texttext-oracle-20261008T161732Z-c58114ad.
Real Safari and installed Mac app were used, not a browser fixture.

Dedicated verification identity: `466761a0-c4e2-4fad-8214-c976fcc30a7a`.
Existing iCloud path:
`Folder move verified 1200/Folder move note 1195-466761a0.textpack`.

1. Safari opened the stable identity and displayed the previously saved Mac
   marker `Installed save verification 1202.` with all older lines.
2. Safari edited and finished saving `Live web return verification 1202.`.
   The already-open Mac reader displayed it automatically, with web presence.
3. A terminal ZIP edit appended `Direct TextPack edit verification 1202.` to
   both canonical document body and Markdown, retaining all other ZIP entries.
   The file was fsynced and atomically replaced in its existing folder.
4. Both already-open readers displayed the direct file change without reload.
5. Mac search immediately found the direct-edit marker at the existing path.
   Escape returned to the saved reader, with no recovery or connection error.

Independent ZIP inspection confirmed stable identity and all seven old/new
verification markers exactly once in both canonical body and Markdown.
Only this dedicated test note changed. This proves the observed local Mac,
Oracle and Safari paths, not second-device iCloud delivery, power-loss behavior
or the pending new Windows installation.
