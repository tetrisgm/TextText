# Native Mac creation paths

The real document-store regression reproduced two independent replicas creating `Untitled.textpack` from the same title. The native app now opts into a filename containing the created document UUID while leaving its title unchanged. Clone/import allocates the UUID once and passes it into package creation, including native import-panel and URL-capture paths. Explicit folder-view destinations retain their existing exact paths and occupied-path refusal.

Existing CLI and durable creation-transaction defaults are unchanged. Existing files are never renamed by this change. This prevents the observed numeric-name collision for new app-created content; it does not repair retained conflicts.

Actual Mac RED showed identical filenames; GREEN passed 36 tests across DocumentCreationTests, LocalVaultImportTests, and LocalVaultRecoveryTests. The new tests check exact identity-bound filenames, unchanged titles, supplied import/clone identities, and occupied-path byte preservation. Log: `/private/tmp/texttext-naming-green.7AeyNJ/test.log`. The owner Package.resolved hash was restored and verified as `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`. Installed acceptance awaits the next unified release.
