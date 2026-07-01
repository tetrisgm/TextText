# Write: architecture

A multi-tenant blogging platform. Next.js App Router on Vercel.

## Tenancy

- Every blog is `{handle}.{ROOT_DOMAIN}`; custom domains later map onto the
  same handles via a lookup table.
- `src/proxy.ts` (Next 16's middleware) resolves the Host header with
  `tenantFromHost()` and rewrites tenant hosts to `/t/{handle}/...`, so the
  app router stays plain. Reserved subdomains live in `src/lib/tenants.ts`.
- Local dev: `demo.localhost:3000` resolves in modern browsers with no
  /etc/hosts changes; `/t/demo` also works path-based.

## Data

- Neon Postgres via Drizzle (`src/lib/db/schema.ts`): `users` (Apple `sub` as
  primary identity), `blogs` (handle, name, accent, bio line, owner),
  `posts` (slug, title, kicker, accent override, cover, markdown body,
  draft/published).
- `src/lib/store.ts` is the only content access point. With `DATABASE_URL`
  unset it serves the demo seed (`src/lib/demo.ts`) so the app runs with zero
  setup; the Postgres implementation fills in behind the same functions.
- Content is markdown with structured columns (title, kicker, accent, cover),
  not frontmatter blobs: the editor edits fields, the reader renders markdown.

## Rendering

- Blog home + post pages are server components; markdown renders on the
  server via react-markdown + remark-gfm.
- The reader is `src/components/Reader.tsx` + `src/styles/broadsheet.css`.
  The post accent rides in as the `--post-accent` CSS variable (may be unset;
  see DESIGN.md for the degradation and contrast rules).

## Auth (next step)

- Sign in with Apple via Auth.js; Apple `sub` is the canonical user key.
  Credentials come from the Apple Developer portal (owner-created, in env).
- The editor (`/editor`) is auth-gated; today it is a static shell of the
  `.applecms` design system.

## Roadmap (in order)

1. Editor v1: field editing + markdown body + live Broadsheet preview
   (the ramine.net CMS proved the postMessage draft-streaming pattern).
2. Auth: Sign in with Apple; blogs owned by users; drafts.
3. Postgres wiring behind `store.ts`; Vercel Blob for covers and figures.
4. Feeds (RSS/Atom/JSON) per blog; sitemaps; OG images.
5. Custom domains (Vercel for Platforms domain API).
6. Billing (Stripe): one paid tier, custom domain + media storage as the
   upgrade.
7. Agent surface: clean markdown-first read API per blog. Posts are as
   legible to agents as to people.

## Positioning (decided, do not relitigate)

A craft-first small commercial product. There is no defensible moat in
publishing tools; the bet is taste, not lock-in. Content is exportable
markdown, always.
