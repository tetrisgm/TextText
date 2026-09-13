## AI provider keys for development

To run the in-app assistant against a real model, keep the key in the login
Keychain, never in a file: service `texttext-dev-anthropic` or
`texttext-dev-openai`, account `api-key`. Provision keys through the fleet account map without putting their values in command arguments.

Then run the assistant against it with `./scripts/dev-with-ai.sh`, which reads
the key through `scripts/dev-secrets.sh` and hands it to the dev server as
`TEXTTEXT_DEV_AI_KEY`; the `/api/ai` route uses it in development in place of
the workspace-saved key. The value is never an argument and never logged.

For a keyless, deterministic run, use the mock instead:
`node scripts/mock-ai-provider.mjs &` then
`TEXTTEXT_AI_BASE_URL=http://localhost:3999/v1 npm run dev`.

Consoles: <https://console.anthropic.com/settings/keys>,
<https://platform.openai.com/api-keys>.

