# Production authentication

TextText supports Sign in with Apple, Sign in with Google, and email magic
links. Every production URL, credential, sender, and callback belongs to
`TextText.app`.

## Canonical URLs

- Sign-in page: `https://TextText.app/signin`
- Apple callback: `https://TextText.app/api/auth/callback/apple`
- Google callback: `https://TextText.app/api/auth/callback/google`
- Email sender: `TextText <noreply@TextText.app>`

No alternate product host is supported. Do not add compatibility redirects,
OAuth callbacks, email senders, certificates, or application links for another
domain.

## Apple

The Services ID is `app.texttext.web`. Its Web Authentication
configuration contains only:

- Domain: `TextText.app`
- Return URL: `https://TextText.app/api/auth/callback/apple`

Production stores the Sign in with Apple `.p8` key as
`AUTH_APPLE_PRIVATE_KEY`, together with `AUTH_APPLE_TEAM_ID`,
`AUTH_APPLE_KEY_ID`, and `AUTH_APPLE_ID`. The server signs a fresh ES256 client
secret on every cold start. `AUTH_APPLE_SECRET` is an optional static fallback
and should normally remain unset.

The macOS app and File Provider extension use Apple application identifiers and
the `group.app.texttext` application group. They do not use a website TLS
certificate.

## Google

The Google OAuth web client contains:

- JavaScript origin: `https://TextText.app`
- Production redirect: `https://TextText.app/api/auth/callback/google`
- Development redirect: `http://localhost:3000/api/auth/callback/google`

The production client is external and published. Its home, privacy, and terms
URLs all use `TextText.app`.

## Email

Magic links are sent through the `noreply@TextText.app` mailbox. Production
stores the SMTP URL in `AUTH_EMAIL_SERVER` and the visible sender in
`AUTH_EMAIL_FROM`. Rotate mailbox credentials in the provider and Vercel
together, then verify SMTP before shipping.

## Release verification

The release gate verifies Apple client-secret signing, TextText-only email
content, same-tick local page creation, local draft authority, and four-client
CRDT convergence. A production smoke pass also opens each sign-in provider,
checks the callback host, and verifies that the installed macOS app reaches the
same account and workspace as the web app.
