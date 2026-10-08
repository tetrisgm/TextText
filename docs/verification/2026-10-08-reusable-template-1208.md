# Reusable agent design acceptance

Installed Mac 0.204 (1208), source `9a38e556`, current iCloud workspace.

- Opened the dedicated `Agent created note 1208` with the previously verified
  agent-generated `Verification note design 1208` design.
- Saved it through the editor's Save as look action as
  `Templates/Agent reusable note verification 1208.textpack`.
- New from template showed that choice. Selecting it created
  `Notes/Untitled 8.textpack`; saved title is
  `Reusable agent template acceptance 1208`, body is
  `Created from the saved agent-designed template.`.
- Package inspection confirmed the same validated template identity/version
  in the template and new item, and distinct Markdown item identities.
- This proves design generation followed by user template saving and creation;
  it does not prove an autonomous agent library-save command or Windows/web
  acceptance.

Inspection found inherited mutation receipts in both new packages. Native
clone now strips identity-specific mutation receipts while retaining opaque
entries and assets. The old-revision clone regression includes a source
receipt and checks its absence from the clone, preservation of other entries,
fresh identity, and unchanged source. All 53 DocumentStore/remote tests passed
in `/tmp/texttext-clone-receipts.log`. This source fix is not installed yet;
Windows and web both use `createWebVaultTransport` and the shared `encodePack`.
The shared encoder now drops only the old item's mutation namespace when the
Markdown identity changes. Ordinary writes retain receipts. Actual transport
regressions cover import and clone for both web and Windows, preserve media and
unknown metadata, retain the original source, and check Windows performs no
cloud file request for the operation. All 330 shared-client tests (38 files)
and TypeScript passed: `/tmp/texttext-copy-receipts-client.log`,
`/tmp/texttext-copy-receipts-types.log`. Mac import uses the fixed native clone;
its import regression also passes (`/tmp/texttext-import-receipts-native.log`).
These source changes require rebuilt clients and Oracle deployment before
claiming runtime delivery. Existing copies are not silently rewritten.
