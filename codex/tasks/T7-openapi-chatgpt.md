# T7: OpenAPI spec + ChatGPT Actions guide over the sync API

Give third-party agents (ChatGPT Actions especially) a machine contract for
the sync API so they can create and edit markdown files without MCP.

## Backend contract (live; do NOT change server code)

The sync API v1 under `src/app/api/sync/v1/` (read the route files):
- `GET /workspace` -> blog + folders
- `GET /folders/{folderId}/manifest` (ETag)
- `GET /files/{postId}` (markdown, ETag) / `POST /files` / `PUT /files/{postId}`
  (If-Match required) / `DELETE /files/{postId}`
- `POST /folders` {parent_path, name}
- `GET /changes?cursor&wait` long-poll
- `GET /captures` / `PUT /captures/{postId}` (multipart)
Bearer `wsk_` tokens from `/connect`. Base URL `https://{host}/api/sync/v1`.
Read `docs/mcp.md` for the model.

## File ownership (STRICT)

- CREATE: `public/openapi/sync-v1.yaml` (OpenAPI 3.1), `docs/chatgpt-actions.md`,
  and `src/app/api/sync/v1/openapi.json/route.ts` (serves the yaml-as-json or a
  static JSON so ChatGPT can fetch the schema at a stable URL). You MAY add a
  short link to the new guide from `docs/ai/page.tsx` (one `<Link>` only) and a
  line in `src/app/llms.txt/route.ts`; if that risks conflict, skip it and note.
- NEVER edit: any route under sync/v1 except the new openapi.json route, the
  editor, store, mcp, or components.
- Commit nothing. Verify: `npx tsc --noEmit`, `NEXT_TELEMETRY_DISABLED=1 npm run build`.

## What to build

1. A complete, valid OpenAPI 3.1 document describing every sync endpoint
   above: paths, params, request/response bodies (markdown is text/markdown;
   captures is multipart/form-data), the Bearer security scheme, ETag/If-Match
   headers, and the status codes each route returns (401/403/404/412/428).
   Validate it parses (a JS yaml+schema check in a scratch script you delete).
2. The openapi.json route serves it at `/api/sync/v1/openapi.json` (read the
   yaml at build/runtime or inline the object; must not require a DB).
3. `docs/chatgpt-actions.md`: step-by-step to add this as a ChatGPT custom
   GPT Action (import the schema URL, set Bearer auth with a wsk_ token from
   /connect, the create-as-draft / never-publish-notes rules from docs/mcp.md).

## Conventions

No em dashes. Sentence case. Verify the OpenAPI actually validates.

## Verify

tsc + build clean; the openapi.json route returns valid JSON (curl it against
`npm run build && npm start` or reason it through). Report the endpoint list
covered and any sync route you could not fully model.
