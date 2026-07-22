import {
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
} from "@/lib/ai/tools";

export const dynamic = "force-dynamic";

const READ_TOOL_COUNT = WORKSPACE_TOOL_NAMES.filter(
  (name) => WORKSPACE_TOOL_DEFINITIONS[name].requiredScope === "read",
).length;
const WORKSPACE_TOOL_COUNT = WORKSPACE_TOOL_NAMES.length;

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;

  return Response.json(openApiDocument(origin), {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}

function openApiDocument(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Texttext AI connector API",
      version: "1.0.0",
      summary: "OAuth setup and markdown content actions for Texttext.",
      description:
        "Import this document into ChatGPT Actions or another AI connector. " +
        "These actions use the sync HTTP API and require the sync scope. " +
        `Texttext also offers a read-only OAuth scope for the ${READ_TOOL_COUNT} read MCP tools, ` +
        "but this document is a smaller action surface, not the complete " +
        `${WORKSPACE_TOOL_COUNT}-tool MCP contract. OAuth uses authorization code with PKCE S256, ` +
        "one-hour access tokens, and rotating refresh tokens.",
    },
    servers: [{ url: origin }],
    security: [{ writeOAuth: ["sync"] }],
    tags: [
      {
        name: "Connect",
        description: "OAuth discovery and dynamic client registration.",
      },
      {
        name: "Workspace",
        description: "Discover the authenticated workspace and folders.",
      },
      {
        name: "Content",
        description: "Create, list, read, and update markdown items.",
      },
    ],
    paths: {
      "/oauth/register": {
        post: {
          tags: ["Connect"],
          operationId: "registerOAuthClient",
          summary: "Register an OAuth client",
          description:
            "Registers a public OAuth client and stores its exact redirect_uri " +
            "allowlist. Redirect URIs must be HTTPS absolute URLs with no " +
            "fragment or userinfo. The client uses PKCE S256 and no client " +
            "secret. Request the least privilege needed, read or sync. A " +
            "request for both advertised scopes receives sync. Include the " +
            "refresh_token grant type to advertise refresh support.",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/OAuthClientRegistrationRequest",
                },
                examples: {
                  publicClient: {
                    summary: "Public MCP client registration",
                    value: {
                      client_name: "Example MCP Client",
                      redirect_uris: [
                        "https://client.example.com/oauth/callback",
                      ],
                      grant_types: ["authorization_code", "refresh_token"],
                      response_types: ["code"],
                      token_endpoint_auth_method: "none",
                      scope: "sync",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Client registered.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/OAuthClientRegistrationResponse",
                  },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRegistration" },
            "413": { $ref: "#/components/responses/BadRegistration" },
            "429": { $ref: "#/components/responses/RateLimited" },
            "503": { $ref: "#/components/responses/TemporarilyUnavailable" },
            default: { $ref: "#/components/responses/UnexpectedError" },
          },
        },
      },
      "/api/sync/v1/workspace": {
        get: {
          tags: ["Workspace"],
          operationId: "listFolders",
          summary: "List folders",
          description:
            "Returns the token owner's workspace and folders. This maps to " +
            "the MCP list_folders tool.",
          "x-mcp-tool": "list_folders",
          responses: {
            "200": {
              description: "Workspace metadata and folders.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/WorkspaceResponse" },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
            "404": { $ref: "#/components/responses/WorkspaceNotFound" },
            default: { $ref: "#/components/responses/UnexpectedError" },
          },
        },
      },
      "/api/sync/v1/folders": {
        post: {
          tags: ["Content"],
          operationId: "createFolder",
          summary: "Create a folder",
          description:
            "Creates a subfolder under an existing folder path. This maps to " +
            "the MCP create_folder tool. The new folder inherits the parent " +
            "folder mode.",
          "x-mcp-tool": "create_folder",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateFolderRequest" },
                examples: {
                  ideas: {
                    summary: "Create a blog ideas folder",
                    value: { parent_path: "blog", name: "Ideas" },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Folder created.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CreateFolderResponse" },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
            "404": { $ref: "#/components/responses/WorkspaceNotFound" },
            default: { $ref: "#/components/responses/UnexpectedError" },
          },
        },
      },
      "/api/sync/v1/folders/{folderId}/manifest": {
        get: {
          tags: ["Content"],
          operationId: "listItems",
          summary: "List items in a folder",
          description:
            "Returns manifest entries for one folder, including drafts and " +
            "private items visible to the token owner. This maps to the MCP " +
            "list_items tool.",
          "x-mcp-tool": "list_items",
          parameters: [
            { $ref: "#/components/parameters/FolderId" },
            { $ref: "#/components/parameters/IfNoneMatch" },
          ],
          responses: {
            "200": {
              description: "Folder manifest.",
              headers: { ETag: { $ref: "#/components/headers/ETag" } },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/FolderManifest" },
                },
              },
            },
            "304": { $ref: "#/components/responses/NotModified" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
            "404": { $ref: "#/components/responses/NotFound" },
            default: { $ref: "#/components/responses/UnexpectedError" },
          },
        },
      },
      "/api/sync/v1/files": {
        post: {
          tags: ["Content"],
          operationId: "createMarkdownItem",
          summary: "Create a markdown item",
          description:
            "Creates an item from a whole markdown file. This maps to the " +
            "MCP create_item tool for root folder modes: article, media_post, " +
            "and video_post create blog drafts, note creates a private note, " +
            "and bookmark creates a private bookmark. New public writing " +
            "should stay status: draft unless the owner asks to publish.",
          "x-mcp-tool": "create_item",
          requestBody: {
            required: true,
            content: {
              "text/markdown": {
                schema: { $ref: "#/components/schemas/MarkdownFile" },
                examples: {
                  draftArticle: {
                    $ref: "#/components/examples/DraftMarkdownFile",
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Item created.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/FileMutationResponse" },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
            "404": { $ref: "#/components/responses/WorkspaceNotFound" },
            default: { $ref: "#/components/responses/UnexpectedError" },
          },
        },
      },
      "/api/sync/v1/files/{postId}": {
        get: {
          tags: ["Content"],
          operationId: "readMarkdownItem",
          summary: "Read a markdown item",
          description:
            "Returns one item as a markdown file. This maps to the MCP " +
            "read_item tool. The ETag is the strong content hash used for " +
            "conflict checks.",
          "x-mcp-tool": "read_item",
          parameters: [
            { $ref: "#/components/parameters/PostId" },
            { $ref: "#/components/parameters/IfNoneMatch" },
          ],
          responses: {
            "200": {
              description: "Markdown file.",
              headers: {
                ETag: { $ref: "#/components/headers/ETag" },
                "Last-Modified": {
                  $ref: "#/components/headers/LastModified",
                },
              },
              content: {
                "text/markdown": {
                  schema: { $ref: "#/components/schemas/MarkdownFile" },
                  examples: {
                    renderedFile: {
                      $ref: "#/components/examples/RenderedMarkdownFile",
                    },
                  },
                },
              },
            },
            "304": { $ref: "#/components/responses/NotModified" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
            "404": { $ref: "#/components/responses/NotFound" },
            default: { $ref: "#/components/responses/UnexpectedError" },
          },
        },
        put: {
          tags: ["Content"],
          operationId: "updateMarkdownItem",
          summary: "Update a markdown item",
          description:
            "Replaces an item with a whole markdown file. This maps to the " +
            "MCP update_item tool. Send If-Match with the last ETag or hash " +
            "to avoid overwriting a concurrent edit. Ask the owner before " +
            "changing status to published.",
          "x-mcp-tool": "update_item",
          parameters: [
            { $ref: "#/components/parameters/PostId" },
            { $ref: "#/components/parameters/IfMatch" },
          ],
          requestBody: {
            required: true,
            content: {
              "text/markdown": {
                schema: { $ref: "#/components/schemas/MarkdownFile" },
                examples: {
                  draftArticle: {
                    $ref: "#/components/examples/DraftMarkdownFile",
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Item updated.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/FileMutationResponse" },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
            "404": { $ref: "#/components/responses/NotFound" },
            "412": { $ref: "#/components/responses/PreconditionFailed" },
            "428": { $ref: "#/components/responses/PreconditionRequired" },
            default: { $ref: "#/components/responses/UnexpectedError" },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        writeOAuth: {
          type: "oauth2",
          description:
            "OAuth authorization code with PKCE S256. Register first at " +
            `${origin}/oauth/register. Access tokens begin with wsk_, expire ` +
            "after 3,600 seconds, and are renewed with rotating wrt_ refresh " +
            "tokens. Reusing a consumed refresh token revokes its complete " +
            "token family.",
          "x-registrationEndpoint": `${origin}/oauth/register`,
          flows: {
            authorizationCode: {
              authorizationUrl: `${origin}/oauth/authorize`,
              tokenUrl: `${origin}/oauth/token`,
              refreshUrl: `${origin}/oauth/token`,
              scopes: {
                read:
                  `Call the ${READ_TOOL_COUNT} read-only MCP workspace tools. The sync HTTP ` +
                  "actions in this document do not accept this scope.",
                sync: "Read and write the authenticated owner's workspace.",
              },
            },
          },
        },
      },
      parameters: {
        FolderId: {
          name: "folderId",
          in: "path",
          required: true,
          description: "Workspace-scoped folder id.",
          schema: { type: "string" },
          example: "0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60",
        },
        PostId: {
          name: "postId",
          in: "path",
          required: true,
          description: "Workspace-scoped item id.",
          schema: { type: "string", format: "uuid" },
          example: "0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60",
        },
        IfNoneMatch: {
          name: "If-None-Match",
          in: "header",
          required: false,
          description: "Revalidate a cached manifest or file with its ETag.",
          schema: { type: "string" },
          example:
            '"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"',
        },
        IfMatch: {
          name: "If-Match",
          in: "header",
          required: true,
          description:
            "Required for item replacement. Use the last ETag, the bare " +
            "manifest hash, or *.",
          schema: { type: "string" },
          example:
            '"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"',
        },
      },
      headers: {
        ETag: {
          description: "Strong ETag containing the sha256 hash in quotes.",
          schema: { type: "string" },
        },
        LastModified: {
          description: "Last modification time for the item, when available.",
          schema: { type: "string", format: "http-date" },
        },
        WWWAuthenticate: {
          description: "Bearer challenge for missing or invalid tokens.",
          schema: { type: "string" },
          example: "Bearer",
        },
      },
      responses: {
        BadRegistration: {
          description: "The OAuth client metadata is invalid.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/OAuthErrorResponse" },
            },
          },
        },
        BadRequest: {
          description: "The request body or markdown file is invalid.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        Unauthorized: {
          description: "A valid OAuth access token is required.",
          headers: {
            "WWW-Authenticate": {
              $ref: "#/components/headers/WWWAuthenticate",
            },
          },
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              example: { error: "A valid API token is required" },
            },
          },
        },
        Forbidden: {
          description: "The token does not have the sync scope.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              example: { error: "This token does not have the sync scope" },
            },
          },
        },
        WorkspaceNotFound: {
          description: "No workspace exists for the token owner.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              example: { error: "No blog exists for this token's user" },
            },
          },
        },
        NotFound: {
          description: "The requested resource was not found.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        NotModified: {
          description: "The cached representation is current.",
          headers: { ETag: { $ref: "#/components/headers/ETag" } },
        },
        PreconditionFailed: {
          description: "The item changed since the client fetched it.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              example: { error: "The post changed since this file was fetched" },
            },
          },
        },
        PreconditionRequired: {
          description: "If-Match is required for this operation.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              example: { error: "If-Match header is required" },
            },
          },
        },
        RateLimited: {
          description: "Too many registration requests.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/OAuthErrorResponse" },
            },
          },
        },
        TemporarilyUnavailable: {
          description: "Registration is temporarily unavailable.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/OAuthErrorResponse" },
            },
          },
        },
        UnexpectedError: {
          description: "Unexpected server error.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
      schemas: {
        OAuthErrorResponse: {
          type: "object",
          additionalProperties: false,
          required: ["error", "error_description"],
          properties: {
            error: { type: "string" },
            error_description: { type: "string" },
          },
        },
        ErrorResponse: {
          type: "object",
          additionalProperties: false,
          required: ["error"],
          properties: {
            error: { type: "string" },
          },
        },
        OAuthClientRegistrationRequest: {
          type: "object",
          additionalProperties: true,
          required: ["redirect_uris"],
          properties: {
            client_name: {
              type: "string",
              maxLength: 80,
              description: "Display name shown during authorization.",
              example: "ChatGPT",
            },
            redirect_uris: {
              type: "array",
              minItems: 1,
              maxItems: 20,
              items: { type: "string", format: "uri" },
              description:
                "Exact redirect URI allowlist. Each URI must be HTTPS, " +
                "absolute, and must not contain a fragment or userinfo.",
            },
            grant_types: {
              type: "array",
              uniqueItems: true,
              contains: { const: "authorization_code" },
              items: {
                type: "string",
                enum: ["authorization_code", "refresh_token"],
              },
              default: ["authorization_code"],
              description:
                "Must include authorization_code and may include " +
                "refresh_token.",
            },
            response_types: {
              type: "array",
              items: { type: "string", enum: ["code"] },
              default: ["code"],
            },
            token_endpoint_auth_method: {
              type: "string",
              enum: ["none"],
              default: "none",
            },
            scope: {
              type: "string",
              pattern: "^(?:(?:read|sync)(?:\\s+(?:read|sync))*)$",
              default: "sync",
              description:
                "Request the least privilege needed. read is MCP read-only " +
                "access; sync grants read/write access and is required by " +
                "every action in this document. A request containing both " +
                "advertised scopes is normalized to sync.",
            },
          },
        },
        OAuthClientRegistrationResponse: {
          type: "object",
          additionalProperties: false,
          required: [
            "client_id",
            "client_id_issued_at",
            "client_name",
            "redirect_uris",
            "grant_types",
            "response_types",
            "token_endpoint_auth_method",
            "scope",
          ],
          properties: {
            client_id: { type: "string" },
            client_id_issued_at: { type: "integer" },
            client_name: { type: "string" },
            redirect_uris: {
              type: "array",
              items: { type: "string", format: "uri" },
            },
            grant_types: {
              type: "array",
              items: {
                type: "string",
                enum: ["authorization_code", "refresh_token"],
              },
            },
            response_types: {
              type: "array",
              items: { type: "string", enum: ["code"] },
            },
            token_endpoint_auth_method: { type: "string", enum: ["none"] },
            scope: { type: "string", enum: ["read", "sync"] },
          },
        },
        WorkspaceResponse: {
          type: "object",
          additionalProperties: false,
          required: ["schema", "blog", "folders"],
          properties: {
            schema: { type: "string", enum: ["write.workspace.v1"] },
            blog: { $ref: "#/components/schemas/Blog" },
            folders: {
              type: "array",
              items: { $ref: "#/components/schemas/Folder" },
            },
          },
        },
        Blog: {
          type: "object",
          additionalProperties: false,
          required: ["handle", "username", "name", "homeLayout", "cardStyle"],
          properties: {
            handle: { type: "string", example: "alice" },
            username: {
              anyOf: [{ type: "string" }, { type: "null" }],
              example: "alice",
            },
            name: { type: "string", example: "Alice Writes" },
            homeLayout: { $ref: "#/components/schemas/BlogHomeLayout" },
            cardStyle: { $ref: "#/components/schemas/BlogCardStyle" },
          },
        },
        BlogHomeLayout: {
          type: "string",
          enum: ["single", "timeline", "grid", "index"],
        },
        BlogCardStyle: {
          type: "string",
          enum: ["cover", "minimal"],
        },
        Folder: {
          type: "object",
          additionalProperties: true,
          required: ["id", "name", "path", "mode"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            path: {
              type: "string",
              description: "Full folder path, such as blog or notes/ideas.",
            },
            mode: { $ref: "#/components/schemas/FolderMode" },
            parentId: {
              anyOf: [{ type: "string" }, { type: "null" }],
            },
          },
        },
        FolderMode: {
          type: "string",
          enum: ["blog", "notes", "bookmarks"],
        },
        CreateFolderRequest: {
          type: "object",
          additionalProperties: false,
          required: ["parent_path", "name"],
          properties: {
            parent_path: {
              type: "string",
              description: "Existing parent folder path.",
              example: "blog",
            },
            name: {
              type: "string",
              description: "Display name for the new folder.",
              example: "Ideas",
            },
          },
        },
        CreateFolderResponse: {
          type: "object",
          additionalProperties: false,
          required: ["folder"],
          properties: {
            folder: { $ref: "#/components/schemas/Folder" },
          },
        },
        FolderManifest: {
          type: "object",
          additionalProperties: false,
          required: ["schema", "folder", "items"],
          properties: {
            schema: { type: "string", enum: ["write.folder.v1"] },
            folder: { $ref: "#/components/schemas/ManifestFolder" },
            items: {
              type: "array",
              items: { $ref: "#/components/schemas/ManifestItem" },
            },
          },
        },
        ManifestFolder: {
          type: "object",
          additionalProperties: false,
          required: ["handle", "name", "mode", "views", "itemKinds", "activeView"],
          properties: {
            handle: { type: "string" },
            name: { type: "string" },
            mode: { $ref: "#/components/schemas/FolderMode" },
            views: {
              type: "array",
              items: { $ref: "#/components/schemas/BlogHomeLayout" },
            },
            itemKinds: {
              type: "array",
              items: { $ref: "#/components/schemas/MarkdownItemKind" },
            },
            activeView: { $ref: "#/components/schemas/BlogHomeLayout" },
            id: { type: "string" },
            path: { type: "string" },
          },
        },
        ManifestItem: {
          type: "object",
          additionalProperties: false,
          required: ["file", "kind", "slug", "title", "status", "hash"],
          properties: {
            file: {
              type: "string",
              description: "Local markdown file path used by sync clients.",
              example: "posts/hello-world.md",
            },
            kind: { $ref: "#/components/schemas/MarkdownItemKind" },
            slug: { type: "string", example: "hello-world" },
            title: { type: "string", example: "Hello world" },
            status: { $ref: "#/components/schemas/PostStatus" },
            id: { type: "string", format: "uuid" },
            date: { type: "string", format: "date" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            url: {
              type: "string",
              description: "Sync API URL for this file.",
              example:
                "/api/sync/v1/files/0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60",
            },
            hash: { $ref: "#/components/schemas/Sha256Hash" },
          },
        },
        MarkdownItemKind: {
          type: "string",
          description:
            "Markdown vocabulary for an item. media_post maps to project " +
            "storage and video_post maps to talk storage.",
          enum: ["article", "media_post", "video_post", "note", "bookmark"],
        },
        PostStatus: {
          type: "string",
          enum: ["draft", "published"],
        },
        Sha256Hash: {
          type: "string",
          pattern: "^[0-9a-f]{64}$",
          example:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
        MarkdownFile: {
          type: "string",
          description:
            "A whole markdown file. Optional frontmatter starts with --- on " +
            "its own line and ends with another --- line. The body follows " +
            "the closing delimiter.",
        },
        FileMutationResponse: {
          type: "object",
          additionalProperties: false,
          required: ["item"],
          properties: {
            item: { $ref: "#/components/schemas/ManifestItem" },
          },
        },
      },
      examples: {
        DraftMarkdownFile: {
          summary: "Draft article markdown",
          value:
            "---\n" +
            "schema: write.markdown-file.v1\n" +
            "kind: article\n" +
            "title: Draft from ChatGPT\n" +
            "status: draft\n" +
            "---\n\n" +
            "Write the body here.\n",
        },
        RenderedMarkdownFile: {
          summary: "Rendered markdown file",
          value:
            "---\n" +
            "schema: write.markdown-file.v1\n" +
            "folder: alice\n" +
            "folderName: Alice Writes\n" +
            "mode: blog\n" +
            "kind: article\n" +
            "type: article\n" +
            "slug: hello-world\n" +
            "title: Hello world\n" +
            "status: draft\n" +
            `canonical: ${origin}/@alice/hello-world\n` +
            "---\n\n" +
            "Hello from the sync API.\n",
        },
      },
    },
  };
}
