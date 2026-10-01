# TextText content-first checkpoint

## Settled product

TextText works from ordinary folders of self-contained TextPacks. A person can edit, rename, and move those files directly. The Mac app, web workspace, Finder projection, and agent tools use the same validated document primitives. The [file-vault architecture](design/texttext-file-vault-migration.md) governs storage, collaboration, recovery, and conflicts.

Article, Bookmark, Brief, Case study, Gallery, Note, Page, Project, Talk, Timeline, and To-do are editable starter TextPacks. Reading list, Contact sheet, and Reference index are folder presets over the same primitives. Templates can be created or changed by an agent without adding another content model or executable presentation code.

## Shipped state

- Version 0.203 build 1150 shipped from `eef38b7e` and is recorded by `e3f75ce7`.
- `/Applications/TextText.app` is the single installed copy. It is notarized, Developer ID signed, arm64, and contains three extensions and `Contents/Helpers/texttext`.
- `texttext.app`, media, PostgreSQL, retained backups, and Mac update files run from Oracle. No TextText storage uses Cloudflare R2 or Vercel Blob.
- The product changelog has one newest `0.203` section and passes TextPack lint.

## Acceptance evidence

### Folders, templates, and agents

- The offline folder browser suite covers creation, templates, capture, image paste, reading, search, recovery, keyboard use, narrow layout, light and dark themes, and reduced motion.
- Local file editing and external atomic edits pass through the real native window. Agent commands address the same paths, use hash guards for writes, attribute mutations, and keep edits visible in the document.
- Starter template assets are bundled in the signed app and validated as TextPacks. Folder presets and agent-authored template proposals have focused coverage.

### Collaboration and sync

- Two-account acceptance covers presence, persisted comments and replies, concurrent convergence, writer-scoped undo and redo, offline recovery, three-editor reload convergence, folder and note discovery, and permission downgrade enforcement.
- A settled editor sends one presence heartbeat and no repeated content mutation uploads. Content sync resumes after a real change or reconnects after an outage without a Retry action.
- Hash and epoch guards reject stale destructive writes while preserving the other writer's bytes.

### Release and hosting

- The exact release gate passed web, database, live workflow, sync, collaboration, native, TestFlight, Apple, TypeScript, and production build checks.
- Production authenticated smoke tests created, read, edited, audited, and removed a scratch note after migration.
- Public 0.203 appcast and ZIP match Oracle byte for byte. Stable and immutable download routes, byte ranges, the version endpoint, and sign-in page pass.
- TextText and Algorave services are active with zero restarts. Both backup timers are active and their newest dumps have readable tables of contents.

### Performance

The historical 240-pack run measured cached item open at 590.9 ms p95. `7f59e8fd` reduced the bounded six-sample comparison to 339.6 ms p95, a 42.5% improvement. A later full production run measured input visibility at 17.9 ms p95. Cached open still misses the original 100 ms target, and the bounded memory samples do not prove leak absence. See the [performance receipt](file-vault-performance-2026-09-30.md).

## Remaining refinement

- Continue profiling cached item open only if the 100 ms target remains a product requirement.
- Oracle-local backups do not survive loss of the Oracle VM or its block storage. That is the explicit Oracle-only durability boundary.
- Interactive production OAuth was not re-entered during the automated release. The public sign-in page is live, native Apple sign-in passed its release checks, and the prior installed flow was accepted manually.

## References

- [Handoff](HANDOFF.md)
- [Implementation receipt](file-vault-implementation-2026-09-30.md)
- [Collaboration receipt](file-vault-collaboration-2026-09-30.md)
- [Recovery receipt](file-vault-recovery-2026-09-30.md)
- [AI sidebar architecture](ai-sidebar-architecture.md)
