# Texttext

A blog that reads like a broadsheet. An Apple-grade writing and publishing
platform: one display serif for the headlines, one quiet accent per post, and
a reading column that puts the words first.

There is a web app at texttext.app and a native macOS app that mounts your
workspace as a Finder location, so your writing is just files you own.

## Run it

```bash
npm install
npm run dev
```

- `http://localhost:3000` is the platform site.
- `http://localhost:3000/@demo` is the demo workspace, served from the
  zero-setup seed in `src/lib/demo.ts`. `/t/demo` and `demo.localhost:3000`
  both redirect there.

No database or credentials are needed for the demo. For real data, run
`bash scripts/setup-local-db.sh` once and see `.env.example`. Never point
`.env.local` at production Neon.

## Read first

- `DESIGN.md`: the design contract (the accent rule, the contrast floor, the
  motion rule). This is the product.
- `ARCHITECTURE.md`: the map of the system.
- `AGENTS.md` and `CLAUDE.md`: how work is done here, including the main-only
  workflow and the release gate.
- `docs/codex/HANDOFF.md`: the current continuation state. It wins over the
  others when they disagree.

## For AI agents

- On this Mac, use the `texttext` CLI that ships inside the app bundle.
- Anywhere else, connect to `https://texttext.app/api/mcp` with OAuth.

`docs/agent-interoperability.md` is the reference for both.

## Stack

Next.js (App Router) on Vercel, Postgres (Neon in production, local Postgres in
development), Vercel Blob, Auth.js with Apple, Google, and email, and Yjs for
collaboration. The macOS app is SwiftPM with a File Provider extension and
Sparkle updates. Fonts: Fraunces and Inter, self-hosted, both SIL OFL licensed.
