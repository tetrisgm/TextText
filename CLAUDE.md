@AGENTS.md

# Write: working notes

Apple-grade multi-tenant blogging platform (Next.js App Router). A craft-first
small commercial product; there is no moat in publishing tools and that is
decided, so the bet is taste. Sibling repo: ~/dev/ramine.net (the personal
portfolio this was extracted from; it stays its own thing).

## Hard rules

- NO em dashes anywhere in copy, prose, or docs.
- Read DESIGN.md before touching the reader or editor styles. The accent
  rule, the 60% ink contrast floor, and the motion rule are contracts.
- Every color decision is checked in BOTH light and dark mode.
- Never commit credentials. Apple/DB secrets are owner-created, env only.

## Verify

- `npx tsc --noEmit` for types, `npm run build` for the full check (this app
  is small; building is cheap, unlike ramine.net).
- The app is plain DOM: browser preview works and screenshots are meaningful.
- Demo content needs zero setup: `npm run dev`, then `/t/demo` or
  `demo.localhost:3000`. If the demo breaks, the scaffold is broken.

## Layout

- `src/proxy.ts`: host -> `/t/{handle}` rewrite (Next 16 proxy, not middleware).
- `src/lib/store.ts`: the ONLY content access point (demo seed today,
  Postgres later). Routes never import demo.ts directly.
- `src/styles/`: tokens.css (neutral palette), broadsheet.css (reader),
  apple.css (editor chrome, scoped .applecms).
- `src/components/Reader.tsx`: the Broadsheet reader.

## Deploy

Not wired yet. When it is: Vercel, and production pushes need an explicit
per-change ask from Ramine, same as ramine.net.
