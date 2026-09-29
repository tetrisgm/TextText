# Command palette cross-folder route check, 2026-09-29

- In the installed local Mac app, opening `Texttext AI setup guide` from `Visual scale proof` through Command-K initially showed the reader under `/@visual-demo/visual-scale-proof/probe-bookmark-capture`. Reloading that address showed a 404. The search result itself named `Mixed workspace check` as the item's folder.
- The palette now supplies the result item's own folder when it asks the workspace shell to open that item. Row and keyboard navigation can still use their current folder context.
- Repeating the same cross-folder search opened `/@visual-demo/notes/mixed-workspace-check/probe-bookmark-capture`. The article title, body, and source link appeared. View > Reload kept that route and rendered the article again.
- `npx tsc --noEmit` passed. Touched-file ESLint had zero errors and 17 pre-existing warnings in `PostWorkspaceShell.tsx`. This checks the installed app against the local development server, not a packaged release.
