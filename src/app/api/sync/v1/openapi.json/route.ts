import { readFile } from "node:fs/promises";
import path from "node:path";
import { load as loadYaml } from "js-yaml";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const filePath = path.join(process.cwd(), "public/openapi/sync-v1.yaml");
  const document = loadYaml(await readFile(filePath, "utf8"));

  return Response.json(withRequestServer(document, request), {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}

function withRequestServer(document: unknown, request: Request): unknown {
  if (!isRecord(document)) return document;

  const origin = new URL(request.url).origin;
  return {
    ...document,
    servers: [{ url: `${origin}/api/sync/v1` }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
