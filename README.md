# TextText

A blog that reads like a broadsheet. An Apple-grade writing and publishing
platform: one display serif for the headlines, one quiet accent per post, and
a reading column that puts the words first.

There is a web app at TextText.app and a native macOS app that mounts your
workspace as a Finder location, so your writing is just files you own.

## Run it

```bash
npm install
npm run dev
```

- `http://localhost:3000` is the platform site.
- `http://demo.localhost:3000` is the public demo workspace, served from the
  zero-setup seed in `src/lib/demo.ts`. Legacy `/@demo` and `/t/demo` links
  redirect to that workspace origin.

No database or credentials are needed for the demo. For real data, run
`bash scripts/setup-local-db.sh` once and see `.env.example`. Never point
`.env.local` at production Neon.

## Read first

- `DESIGN.md`: the design contract (the accent rule, the contrast floor, the
  motion rule). This is the product.
- `ARCHITECTURE.md`: the map of the system.
- `AGENTS.md`: product invariants and verification. `CLAUDE.md` includes it.

## For AI agents

- On this Mac, use the `texttext` CLI that ships inside the app bundle.
- Anywhere else, connect to `https://TextText.app/api/mcp` with OAuth.

`docs/agent-interoperability.md` is the reference for both.

## Stack

Next.js (App Router) on Vercel, Postgres (Neon in production, local Postgres in
development), Vercel Blob, Auth.js with Apple, Google, and email, and Yjs for
collaboration. The macOS app is SwiftPM with a File Provider extension and
Sparkle updates. Fonts: Fraunces and Inter, self-hosted, both SIL OFL licensed.
