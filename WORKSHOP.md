# Workshop: TextText.app

Project ID: `texttext`

Use `workshop quick` for the normal dependency, typecheck, and unit-test
preflight. `workshop full` also performs a production build when the required
non-production environment is available on the worker.

Workshop must not use production Neon, run release migrations, deploy Vercel,
publish the Mac app, or replace `npm run verify:release`. Production and release
credentials are intentionally absent from the worker.

Build receipts are written to
`agents/artifacts/builds/<timestamp>-texttext/`. Durable non-Git project data
belongs under `agents/artifacts/texttext/`.

Platform source, registry, and recovery instructions live at
`/Users/shokunin/agents/workshop/README.md`.
