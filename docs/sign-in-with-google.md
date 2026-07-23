# Sign in with Google: production setup

Texttext uses Auth.js's Google provider. The provider is enabled only when both
production environment variables are present:

- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`

Never commit either value. Store them as encrypted Vercel Production variables.

## Current Texttext registration

The production registration is:

- Google Cloud project name: `Texttext`
- Google Cloud project ID: `project-9ddb389f-8f22-482d-abf`
- OAuth client name: `Texttext`
- Application type: Web application
- Authorized JavaScript origin: `https://texttext.app`
- Authorized redirect URI:
  `https://texttext.app/api/auth/callback/google`
- Local development redirect URI:
  `http://localhost:3000/api/auth/callback/google`
- Audience: External
- Publishing status: In production
- Authorized domain: `texttext.app`
- Application home page: `https://texttext.app`
- Privacy policy: `https://texttext.app/privacy`
- Terms of service: `https://texttext.app/terms`

No other production host is authorized. Localhost remains registered solely for
local development.

## Console setup

Open the
[Google Auth Platform](https://console.cloud.google.com/auth/clients?project=project-9ddb389f-8f22-482d-abf)
and select the `Texttext` project.

1. Under Branding, use `Texttext` as the app name and register the production
   home, privacy, and terms URLs listed above.
2. Under Audience, keep the app External and In production.
3. Under Clients, open the `Texttext` web client.
4. Register `https://texttext.app` as an authorized JavaScript origin.
5. Register the exact Auth.js callback URL shown above.
6. Store the client ID and client secret in Vercel Production.

Google no longer reveals an existing client secret after creation. If the
secret is lost, add a new client secret, update `AUTH_GOOGLE_SECRET`, deploy,
verify sign-in, and then disable the previous secret.

## Verification

After deployment:

1. Open `https://texttext.app/signin`.
2. Choose Continue with Google.
3. Confirm Google identifies the application as Texttext.
4. Complete sign-in and confirm the browser returns to Texttext without
   `redirect_uri_mismatch`, `invalid_client`, or an Auth.js configuration error.
5. Confirm the macOS app reaches the same account and workspace.
