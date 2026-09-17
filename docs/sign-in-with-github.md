# GitHub: sign-in and repositories

One GitHub App does both jobs. As an OAuth provider it signs people in like
Apple and Google, taking name, avatar, and verified email only, and links to
the existing account through `user_identities` (subject `github:<account id>`).
As an installed app it reaches the repositories a person chooses, and that is
what the workspace backup pushes with. No contributor grants, no "Made by"
pages, no repository-cited pages.

## Environment variables

The code reads five values. Sign-in needs the first two; repositories need all
five. Nothing is enabled until they exist, and nothing else in the app changes.

| variable | what it is | needed for |
| --- | --- | --- |
| `AUTH_GITHUB_ID` | the app's OAuth client id (`Iv1...` or `Iv23...`) | sign-in, Connect |
| `AUTH_GITHUB_SECRET` | the app's OAuth client secret | sign-in, Connect |
| `GITHUB_APP_ID` | the numeric App ID from the app's General page | installation tokens |
| `GITHUB_APP_SLUG` | the URL name of the app (`github.com/apps/<slug>`) | the Connect link |
| `GITHUB_APP_PRIVATE_KEY` | the downloaded `.pem` contents; escaped `\n` newlines are accepted | installation tokens |

Where they go, following the Google setup:

- `.env.local` for development, next to `AUTH_SECRET`.
- Vercel Production encrypted variables for texttext.app.
- The private key is a shown-once credential: file it in the login Keychain
  as service `texttext-github-app`, account `GITHUB_APP_PRIVATE_KEY`, and the
  client secret as account `AUTH_GITHUB_SECRET` under the same service, so
  the values survive if an environment is rebuilt. Nothing in the release path
  reads the Keychain item; it is the backup copy.

## Current registration

Created 2026-09-17 through the app-manifest flow, owned by the `tetrisgm`
GitHub account: slug `texttextapp`, App ID `4975359`, client id starting
`Iv23`. Callbacks and setup URL as listed below; permissions Contents write,
Metadata read, Email addresses read; webhook off; public. Values filed in
`.env.local`, Vercel Production, and Keychain service `texttext-github-app`.

## The GitHub App registration

Settings, Developer settings, GitHub Apps, New GitHub App (or the manifest
flow: one POST of the manifest, then `POST /app-manifests/{code}/conversions`
returns the id, slug, client id, secret, and pem in one answer).

- Name: `TextText`. Homepage: `https://texttext.app`.
- Callback URLs (both): `https://texttext.app/api/auth/callback/github` and
  `https://texttext.app/api/github/setup/verify`. Add the same two on
  `http://localhost:3000` for development.
- Leave "Expire user authorization tokens" on and "Request user authorization
  (OAuth) during installation" off. Sign-in and installation are separate
  steps on purpose.
- Setup URL: `https://texttext.app/api/github/setup`, with "Redirect on
  update" on. For development, GitHub allows one setup URL per app; use a
  second app registered against localhost when testing the install flow.
- Webhook: off. The app does not receive events; it asks GitHub when it needs
  to know.
- Permissions. Repository: Contents read and write (the backup commits),
  Metadata read (implied). Account: Email addresses read (the verified email
  at sign-in). Nothing else.
- Where can this app be installed: any account.

After creating it: note the App ID and the slug, generate a client secret,
generate and download a private key.

## What the code does with them

- `/signin` shows Continue with GitHub, and Settings, Account, Ways to sign in
  shows a GitHub row with Connect, once `AUTH_GITHUB_ID` and
  `AUTH_GITHUB_SECRET` exist.
- Settings shows a GitHub section with Connect GitHub once all five exist.
  Connect sends the owner to `github.com/apps/<slug>/installations/new` with a
  signed state; GitHub returns to `/api/github/setup`, which sends the owner
  through the app's OAuth to `/api/github/setup/verify`, where the code
  confirms through `GET /user/installations` that the person can see that
  installation before storing it in `github_installations`. The user token
  from that step is used once and dropped.
- Installation tokens are minted per call with an RS256 app JWT
  (`src/lib/github/app.server.ts`) and cached until a minute before expiry.

## Verification

1. `/signin`: Continue with GitHub, GitHub names the app TextText, the
   browser returns to the workspace, and Settings, Account shows GitHub as
   Connected.
2. Settings, GitHub: Connect GitHub, choose an account and repositories on
   GitHub, and the section shows the account with Manage on GitHub.
3. `npm run test:reading:db` covers the store side; `npx vitest run
   src/lib/github` covers the JWT, tokens, and the setup state.
