# Texttext

A blog that reads like a broadsheet. An Apple-grade writing and publishing
platform: one display serif for the headlines, one quiet accent per post, and
a reading column that puts the words first.

Born from an earlier personal site: the Broadsheet reader design and the
Apple Notes-style editor were shipped there first, then
extracted here as the seed of a small commercial product.

## Run it

```bash
npm install
npm run dev
```

- `http://localhost:3000` is the platform site.
- `http://demo.localhost:3000` (or `/t/demo`) is the demo blog, served from
  the zero-setup seed in `src/lib/demo.ts`.
- `http://localhost:3000/editor` is the editor shell (Apple Notes chrome).

No database or credentials needed for the demo; see `.env.example` for the
real thing.

## Read first

- `DESIGN.md`: the design contract (the accent rule, the contrast floor, the
  motion rule). This is the product.
- `ARCHITECTURE.md`: tenancy, data model, roadmap.

## Stack

Next.js (App Router) on Vercel · Drizzle + Neon Postgres · Auth.js with Sign
in with Apple (next step) · react-markdown. Fonts: Fraunces and Inter,
self-hosted, both SIL OFL licensed.
