# ChatGPT Actions setup for the Write sync API

This guide connects a custom GPT to the Write sync API so it can work with
markdown files without MCP.

## What the action can do

The sync API treats a Write blog as one workspace of folders and markdown files.
With a `wsk_` token from `/connect`, a ChatGPT Action can:

- List the workspace folders.
- Read folder manifests with file hashes.
- Read markdown files.
- Create markdown files.
- Replace markdown files with `If-Match` conflict checks.
- Delete files when the owner explicitly asks.
- Long-poll for changes.
- List and upload bookmark capture results.

Base URL:

```text
https://{host}/api/sync/v1
```

Schema URL for ChatGPT Actions:

```text
https://{host}/api/sync/v1/openapi.json
```

The raw OpenAPI YAML is also available at:

```text
https://{host}/openapi/sync-v1.yaml
```

## Create a token

1. Sign in to Write.
2. Open `https://{host}/connect`.
3. Create a token for ChatGPT.
4. Copy the token immediately. It is shown once and starts with `wsk_`.
5. Revoke this token from `/connect` if the GPT should lose access.

Every API request must send:

```http
Authorization: Bearer wsk_...
```

## Add the Action to a custom GPT

1. Open the GPT editor in ChatGPT.
2. Create or edit the GPT that should manage Write markdown files.
3. Open the Actions section.
4. Import the schema from `https://{host}/api/sync/v1/openapi.json`.
5. Set authentication to API key authentication.
6. Configure it to send the key as a bearer token in the `Authorization` header.
7. Paste the `wsk_...` token from `/connect`.
8. Save the Action.
9. Use the Action test control for `getWorkspace`, then `getFolderManifest`,
   then `createFile` with a draft markdown example.

OpenAI's GPT Actions documentation describes the same high-level flow: define
an OpenAPI schema, choose an authentication method such as API key or OAuth,
add authentication settings, write GPT instructions, and test each Action.

References:

- https://developers.openai.com/api/docs/actions/getting-started
- https://developers.openai.com/api/docs/actions/authentication

## Recommended GPT instructions

Paste instructions like these into the custom GPT:

```text
You can edit the owner's Write workspace through the Write sync API.

Rules:
- Treat the workspace as folders of markdown files.
- Use getWorkspace first to learn the available folders.
- Use getFolderManifest to find file ids and current hashes.
- Use getFile before editing an existing file.
- For updates, send replaceFile with If-Match set to the last file ETag or the manifest hash.
- If replaceFile returns 412, re-read the file, merge the user's requested change, and retry.
- Create public writing as status: draft unless the owner explicitly asks to publish.
- Ask before publishing anything.
- Never try to publish notes or bookmarks. They are private and stay unlisted.
- Ask before deleting a file.
- Keep the markdown format intact: single-line key: value frontmatter, then the body.
```

## Markdown file rules

Files are plain markdown. Optional frontmatter starts and ends with `---`.
Frontmatter is not full YAML. It is single-line `key: value` pairs. Values can
be JSON scalars, arrays, or objects on one line, or plain text.

Safe draft example:

```markdown
---
schema: write.markdown-file.v1
kind: article
title: Draft from ChatGPT
status: draft
---

Write the body here.
```

Public blog items can use `kind: article`, `kind: media_post`, or
`kind: video_post`. Notes use `kind: note`. Bookmarks use `kind: bookmark`.

For notes and bookmarks, the server keeps items unlisted. Do not set
`status: published` for them.

## Conflict handling

Every manifest item has a `hash`. Reading a file also returns an `ETag` header.
Before replacing a file, send the current value as `If-Match`.

Example:

```http
PUT /api/sync/v1/files/0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60
Authorization: Bearer wsk_...
If-Match: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
Content-Type: text/markdown
```

If the response is `412`, another client changed the file. Read the latest
file, merge the requested edit, and retry with the new `ETag`.

If the response is `428`, the request missed `If-Match`.

## Endpoint checklist

- `GET /workspace`
- `POST /folders`
- `GET /folders/{folderId}/manifest`
- `POST /files`
- `GET /files/{postId}`
- `PUT /files/{postId}`
- `DELETE /files/{postId}`
- `GET /changes`
- `GET /captures`
- `PUT /captures/{postId}`
