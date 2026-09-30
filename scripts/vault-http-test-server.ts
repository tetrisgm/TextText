/** Opt-in loopback contract fixture. No real auth, database, or permanent jobs.
 * Started and terminated by LocalVaultHTTPContractTests; never ship this server. */
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  listVaultTextpacks, readVaultTextpack, writeVaultTextpack,
  moveVaultTextpack, deleteVaultTextpack, waitVaultTextpacks,
} from "../src/lib/vault/server-store";

const [root, readyFile] = process.argv.slice(2);
if (!root || !readyFile || !path.isAbsolute(root) || !path.isAbsolute(readyFile)) throw new Error("Pass absolute fixture root and ready-file paths");
const workspaceId = "contract-workspace";
const fixtureAuthorization = "Bearer vault-http-fixture";
let loseNextReply = false;
const counts = { uploads: 0, downloads: 0, manifests: 0, renames: 0, deletions: 0 };

const server = createServer(async (request, response) => {
  const send = (status: number, value: unknown, headers: Record<string, string> = {}) => {
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
    response.end(JSON.stringify(value));
  };
  if (request.headers.authorization !== fixtureAuthorization) { send(401, { error: "Fixture token required" }); return; }
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/__test/lose-next-reply") { loseNextReply = true; send(200, {}); return; }
  if (url.pathname === "/__test/stats") { send(200, counts); return; }
  if (url.pathname === "/api/vault") { send(200, { workspaceId, name: "Contract fixture" }); return; }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "vault" || parts[2] !== workspaceId || parts[3] !== "items") {
    send(404, { error: "Fixture workspace not found" }); return;
  }
  const location = { root, workspaceId };
  const itemId = parts[4];
  const header = (name: string) => typeof request.headers[name] === "string" ? request.headers[name] as string : "";
  try {
    if (!itemId && request.method === "GET") {
      counts.manifests++;
      const previous = header("if-none-match");
      const controller = new AbortController();
      response.once("close", () => controller.abort());
      const manifest = url.searchParams.has("wait") && previous
        ? await waitVaultTextpacks({ ...location, revision: previous.replaceAll('"', ""), waitMs: 25_000, signal: controller.signal })
        : await listVaultTextpacks(location);
      const etag = `"${manifest.revision}"`;
      if (previous === etag) { response.writeHead(304, { ETag: etag }); response.end(); }
      else send(200, manifest, { ETag: etag });
      return;
    }
    if (!itemId) { send(404, {}); return; }
    if (request.method === "GET") {
      counts.downloads++;
      const item = await readVaultTextpack({ ...location, itemId });
      if (!item) { send(404, {}); return; }
      response.writeHead(200, { "Content-Type": "application/zip", ETag: `"${item.revision}"`, "X-TextText-Path": encodeURIComponent(item.relativePath) });
      response.end(item.bytes); return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk);
      if ((size += bytes.length) > 64 * 1024 * 1024) { send(413, {}); return; }
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks);
    const operationId = header("x-texttext-operation-id");
    const match = header("if-match");
    const baseRevision = match ? match.replaceAll('"', "") : null;
    let result;
    if (request.method === "PUT") {
      counts.uploads++;
      if (!match && header("if-none-match") !== "*") { send(428, {}); return; }
      result = await writeVaultTextpack({ ...location, itemId, operationId, baseRevision,
        relativePath: decodeURIComponent(header("x-texttext-path")), bytes,
      });
      if (loseNextReply) { loseNextReply = false; request.socket.destroy(); return; }
    } else if ((request.method === "PATCH" || request.method === "DELETE") && baseRevision) {
      const mutation = { ...location, itemId, operationId, baseRevision, basePath: decodeURIComponent(header("x-texttext-base-path")) };
      if (request.method === "PATCH") {
        counts.renames++;
        result = await moveVaultTextpack({ ...mutation, relativePath: JSON.parse(bytes.toString()).relativePath });
      } else {
        counts.deletions++;
        result = await deleteVaultTextpack(mutation);
      }
    } else { send(405, {}); return; }
    send(result.status === "conflict" ? 409 : 200, result);
  } catch (error) { send(500, { error: error instanceof Error ? error.message : "Fixture failed" }); }
});

server.listen(0, "127.0.0.1", async () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  await writeFile(readyFile, JSON.stringify({ origin: `http://127.0.0.1:${address.port}` }));
});
process.once("SIGTERM", () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
