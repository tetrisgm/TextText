# Third-party AI connector notes

## Endpoints added or updated

- `POST /oauth/register`: OAuth Dynamic Client Registration for public clients. It accepts JSON client metadata, validates `redirect_uris` fail-closed, stores the exact allowlist, and returns a `client_id`.
- `GET /.well-known/oauth-authorization-server`: now advertises `registration_endpoint` and `service_documentation`.
- `GET /openapi.json`: OpenAPI 3.1 document for OAuth registration plus the existing sync HTTP content actions that map to the MCP tools.
- `/docs/ai`: rewritten as a short ChatGPT and AI connector setup guide.

## Database table

Added `oauth_clients` in `src/lib/db/schema.ts`.

Columns:

- `id`
- `client_id`
- `client_name`
- `redirect_uris`
- `scope`
- `created_at`
- `updated_at`
- `revoked_at`

`client_id` is unique. `redirect_uris` is JSONB and stores the exact registered allowlist. Registered clients are loaded alongside `OAUTH_CLIENTS` env clients by the OAuth authorize and token routes.

## Migrations

This repo does not currently include checked-in Drizzle migration files. Schema changes are applied here through Drizzle push:

```bash
npm run db:push
```

Run that against the target database before enabling dynamic registration in an environment with `DATABASE_URL`.

## OpenAPI URL

Use:

```text
https://<write-host>/openapi.json
```

For local development, the route follows the request origin.

## Deferred TODOs

- `src/app/llms.txt/route.ts` still references `/api/sync/v1/openapi.json`. It should point to `/openapi.json`, but that file was outside this task's ownership boundary.
- No MCP route handlers were changed. The OpenAPI file describes the existing sync HTTP endpoints that correspond to the MCP tools.
