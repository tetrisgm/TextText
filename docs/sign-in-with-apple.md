# Sign in with Apple: production setup

The editor's auth gate and per-user blogs already work (verified locally via the
dev login). To make real Sign in with Apple work you create credentials in the
Apple Developer portal, which produce two env vars:

- `AUTH_APPLE_ID` = the **Services ID** identifier (the OAuth `client_id`).
- `AUTH_APPLE_SECRET` = a **signed ES256 JWT** ("client secret"), generated from
  a `.p8` key. It expires (Apple caps it at 6 months), so it must be rotated.

No code changes are needed: the provider is already
`Apple({ clientId: AUTH_APPLE_ID, clientSecret: AUTH_APPLE_SECRET })`.

## Prerequisite: a stable HTTPS domain

Apple rejects `localhost`, `http`, wildcards (`*.vercel.app`), and per-deploy
preview URLs. You need one stable custom HTTPS domain that hosts `/editor` (sign
in terminates there; tenants route through that one canonical host, so you only
register one return URL). For local testing you can use an HTTPS tunnel
(e.g. ngrok) and register that exact host, but the dev login already covers
local testing, so the simplest path is: set Apple up once against the production
domain.

All portal work is at https://developer.apple.com/account/resources (you need
the Account Holder or Admin role).

## 1. Primary App ID

Identifiers -> (+) -> **App IDs** -> App -> Continue.
- Description: e.g. `Write`.
- **Explicit** App ID, Bundle ID in reverse-DNS, e.g. `net.ramine.write`.
- Tick the **Sign in with Apple** capability. Continue -> Register.

## 2. Services ID  (this value becomes `AUTH_APPLE_ID`)

Identifiers -> (+) -> **Services IDs** -> Continue.
- Description: e.g. `Write Web Sign In`.
- Identifier in reverse-DNS, distinct from the App ID, e.g. `net.ramine.write.web`.
- Continue -> Register.

Then select that Services ID, tick **Sign in with Apple**, click **Configure**:
- **Primary App ID**: the App ID from step 1 (only Sign-in-enabled App IDs show).
- **Domains and Subdomains**: the bare host, no scheme, no trailing slash, e.g.
  `write.ramine.net`.
- **Return URLs**: the full HTTPS callback, exactly:
  `https://write.ramine.net/api/auth/callback/apple`
  (path is Auth.js's `/api/auth` basePath + `/callback/apple`; no trailing slash,
  it must match byte-for-byte what Auth.js sends).
- Save.

You do **not** need to host `apple-developer-domain-association.txt`. Apple only
requires that file for the separate private email-relay service, not for OAuth
sign in.

`AUTH_APPLE_ID` = this Services ID string (e.g. `net.ramine.write.web`). It is
NOT the App ID / bundle ID.

## 3. Sign in with Apple Key (.p8)

Keys -> (+).
- Key Name: e.g. `Write Sign In Key`.
- Tick **Sign in with Apple** -> Configure -> pick the primary App ID from step 1
  -> Continue -> Confirm.
- **Download** the key. It saves as `AuthKey_XXXXXXXXXX.p8`. You can download it
  only once; store it securely and never commit it.
- The 10-char **Key ID** is shown under the key name (and is the `XXXXXXXXXX` in
  the filename).

## 4. Team ID

Account -> **Membership details** -> the 10-character Team ID.

## 5. Generate `AUTH_APPLE_SECRET`

You now have four inputs: Team ID, Key ID, the Services ID, and the `.p8` path.
Mint the JWT with the committed script (zero dependencies, emits the correct
ES256 / raw-R||S signature Apple requires):

```sh
node scripts/apple-client-secret.mjs \
  --team-id ABCDE12345 \
  --key-id KEY1234567 \
  --services-id net.ramine.write.web \
  --p8 ~/Downloads/AuthKey_KEY1234567.p8
```

It prints the JWT to stdout. (Auth.js's `npx auth add apple` does the same thing
interactively and writes the env for you; either works.)

## 6. Set env and deploy

Set on the Vercel project (Production), never committed:
- `AUTH_APPLE_ID` = the Services ID.
- `AUTH_APPLE_SECRET` = the JWT from step 5.
- `AUTH_SECRET` = any random string (`openssl rand -base64 32`).

Do NOT set `AUTH_DEV_LOGIN` in production (it is also force-disabled whenever
`NODE_ENV=production`). Deploy. `/editor` will show the real "Sign in with Apple"
button, and the same per-user blog provisioning runs on the Apple `sub`.

## Rotation and notes

- **The secret expires (<= 6 months).** When Apple sign-in suddenly fails with
  `invalid_client` in production, first suspect an expired `AUTH_APPLE_SECRET`;
  regenerate with step 5 and redeploy. Consider a cron reminder.
- Apple returns the user's **name and email only on the first consent**. The app
  already persists them on first sign in and preserves them afterward
  (`ensureOwnerBlog`), so this is handled. To re-test the first-consent path,
  remove the app at https://appleid.apple.com under Sign in with Apple.
- Common `invalid_client` causes: `AUTH_APPLE_ID` set to the App ID instead of
  the Services ID; the JWT `sub` not equal to `AUTH_APPLE_ID`; a DER-encoded
  signature (the script avoids this); or a return-URL host mismatch.
