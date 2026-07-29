import { ResourceTemplate } from "./types";
import type { CapabilityCollector } from "./types";
import type { CallToolResult } from "./types";
import { z } from "zod";
import { runWorkspaceToolForAuth, type ToolContext } from "./tools";

const AGENT_GUIDE = `# Texttext agent guide

Texttext is a workspace of portable documents. Use the tools exposed by this
server for every read and mutation. Do not construct private storage URLs or
write directly to the database.

## Reliable automation

- Pass a stable idempotency_key to create_item. Derive it from the durable
  identity of the source, such as a repository URL or project slug.
- Pass a stable idempotency_key to append_to_item. Derive it from the source
  event, such as a commit SHA, release version, or conversation message ID.
- Reuse the same key after a timeout. A successful retry returns replayed: true.
- Read an item before changing it and pass if_match_hash to guarded mutations.
- Treat conflicts as a request to read, merge, and retry.

## Privacy and audience

New items are drafts. Notes and bookmarks cannot be published. Never publish,
share, delete, or revoke access without an explicit user instruction.

## Project changelogs

Create one item per project with a stable creation key. Keep the returned item
ID. Append one dated Markdown section for each meaningful update with a stable
event key. This makes repeated agent runs safe and prevents duplicate entries.

## Live document canvases

Use one durable Texttext item as the visible canvas for a body of work. Search
for it first or create it once with a stable key, keep its item ID, and tell the
user which item to open. Keep updating that same item while the work develops.
When it is open in Texttext, agent changes and the user's edits share the live
collaboration document. Use guarded update_item calls for coherent rewrites and
append_to_item with a stable source-event key for incremental additions. If an
edit conflicts, read the latest item, merge both intents, and retry.
`;

function textFromToolResult(result: CallToolResult): string {
  const text = result.content.find((part) => part.type === "text");
  if (!text || text.type !== "text") return "{}";
  return text.text;
}

function valueFromToolResult(result: CallToolResult): unknown {
  if (result.structuredContent) return result.structuredContent;
  const text = textFromToolResult(result);
  try {
    return JSON.parse(text);
  } catch {
    return result.isError ? { error: text } : { text };
  }
}

/** Declares this server's resources and prompts into a collector. There is no
 * long-lived server object in MCP 2026-07-28, so these are data: registry.ts
 * collects them once and the transport looks them up per request. */
export function registerAgentSurface(server: CapabilityCollector): void {
  server.registerResource(
    "texttext-agent-guide",
    "texttext://agent-guide",
    {
      title: "Texttext agent guide",
      description:
        "Reliability, privacy, and workflow rules for agents using Texttext.",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: "texttext://agent-guide",
          mimeType: "text/markdown",
          text: AGENT_GUIDE,
        },
      ],
    }),
  );

  server.registerResource(
    "texttext-workspace",
    "texttext://workspace",
    {
      title: "Connected Texttext workspace",
      description: "The connected workspace and its visible folders.",
      mimeType: "application/json",
    },
    async (_uri, extra) => {
      const context = extra as ToolContext;
      const [workspace, folders] = await Promise.all([
        runWorkspaceToolForAuth("get_workspace", {}, context),
        runWorkspaceToolForAuth("list_folders", {}, context),
      ]);
      return {
        contents: [
          {
            uri: "texttext://workspace",
            mimeType: "application/json",
            text: JSON.stringify(
              {
                workspace: valueFromToolResult(workspace),
                folders: valueFromToolResult(folders),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    "texttext-item",
    new ResourceTemplate("texttext://items/{id}"),
    {
      title: "Texttext item",
      description: "One item, including its Markdown, metadata, and assets.",
      mimeType: "application/json",
    },
    async (uri, variables, extra) => {
      const id = (variables as Record<string, string | string[]>).id;
      const result = await runWorkspaceToolForAuth(
        "read_item",
        { id: Array.isArray(id) ? id[0] : id },
        extra as ToolContext,
      );
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: textFromToolResult(result),
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "maintain_project_documents",
    {
      title: "Maintain project documents",
      description:
        "Create one durable project document per project and append each update exactly once.",
      argsSchema: {
        projects: z
          .string()
          .min(1)
          .describe("Project names and stable identifiers, one per line."),
        folder_path: z
          .string()
          .optional()
          .describe('Destination folder path. Defaults to "notes".'),
        namespace: z
          .string()
          .optional()
          .describe('Stable automation namespace. Defaults to "projects".'),
      },
    },
    async ({ projects, folder_path, namespace }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Maintain project documents in Texttext.

Projects:
${projects}

Destination: ${folder_path || "notes"}
Namespace: ${namespace || "projects"}

For each project, call create_item with a stable idempotency_key in the form
"${namespace || "projects"}:project:<stable-project-id>". Keep the returned item
ID. For every later update, append a dated Markdown changelog section with
append_to_item and an idempotency_key in the form
"${namespace || "projects"}:event:<stable-project-id>:<stable-event-id>".
Reuse keys on retries. Read before other mutations and use if_match_hash.
Do not publish, share, or delete anything without explicit confirmation.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "use_live_document_canvas",
    {
      title: "Use a live document canvas",
      description:
        "Create or find one durable document and keep it current while the user works alongside the agent.",
      argsSchema: {
        title: z.string().min(1),
        goal: z.string().min(1),
        folder_path: z
          .string()
          .optional()
          .describe('Destination folder path. Defaults to "notes".'),
        source_id: z
          .string()
          .min(1)
          .describe("Stable identity for this body of work."),
      },
    },
    async ({ title, goal, folder_path, source_id }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Use one Texttext item as the live document canvas for this work.

Title: ${title}
Goal: ${goal}
Destination: ${folder_path || "notes"}
Stable source ID: ${source_id}

Search for the existing item first. If it does not exist, call create_item once
with idempotency_key "canvas:${source_id}". Keep its returned item ID and tell
the user exactly which item to open in Texttext. Keep that same item current as
the work develops. Use guarded update_item calls for coherent rewrites. Use
append_to_item for incremental additions with an idempotency_key derived from
the durable source event. Reuse that event key on retries.

The user may edit the open item while you work. Texttext routes active edits
through its collaboration document. Preserve the user's concurrent changes. If
a mutation conflicts, read the latest item, merge both intents, and retry. Do
not publish, share, delete, or change access without explicit confirmation.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "capture_conversation",
    {
      title: "Capture a conversation",
      description:
        "Turn a useful AI conversation or excerpt into a portable Texttext document.",
      argsSchema: {
        title: z.string().min(1),
        conversation: z.string().min(1),
        folder_path: z.string().optional(),
        source_id: z.string().min(1),
      },
    },
    async ({ title, conversation, folder_path, source_id }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Create a draft Texttext item titled "${title}" in
"${folder_path || "notes"}". Preserve useful prompts, answers, decisions, and
source context as readable Markdown. Use create_item with idempotency_key
"conversation:${source_id}". Do not publish it.

Conversation:
${conversation}`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "prepare_release_note",
    {
      title: "Prepare a release note",
      description:
        "Append a retry-safe release entry to an existing project document.",
      argsSchema: {
        item_id: z.string().uuid(),
        version: z.string().min(1),
        changes: z.string().min(1),
      },
    },
    async ({ item_id, version, changes }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Read Texttext item ${item_id}. Append a dated Markdown release
section for version ${version} containing the changes below. Use append_to_item
with idempotency_key "release:${item_id}:${version}". Do not publish or change
access without explicit confirmation.

Changes:
${changes}`,
          },
        },
      ],
    }),
  );
}
