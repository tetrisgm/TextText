/** Opt-in loopback contract fixture. No real auth, database, or permanent jobs.
 * Started and terminated by LocalVaultHTTPContractTests; never ship this server. */
import { createServer } from "node:http";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { lstatSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import {
  listVaultTextpacks, readVaultTextpack, writeVaultTextpack,
  moveVaultTextpack, deleteVaultTextpack, restoreVaultTextpack, waitVaultTextpacks, moveVaultFolderCase, recoverVaultFolderCase,
} from "../src/lib/vault/server-store";

import { planFolderMove } from "../src/sync/engine/folder-move-plan";

const [root, readyFile] = process.argv.slice(2);
if (!root || !readyFile || !path.isAbsolute(root) || !path.isAbsolute(readyFile)) throw new Error("Pass absolute fixture root and ready-file paths");
const workspaceId = "contract-workspace";
const fixtureBind = process.env.TEXTTEXT_HTTP_FIXTURE_BIND ?? "127.0.0.1";
const fixtureToken = process.env.TEXTTEXT_HTTP_FIXTURE_TOKEN ?? "vault-http-fixture";
if(fixtureBind!=="127.0.0.1"){
  const octets=fixtureBind.split(".").map(Number);
  const privateAddress=octets[0]===10||octets[0]===172&&octets[1]>=16&&octets[1]<=31||octets[0]===192&&octets[1]===168;
  const local=Object.values(networkInterfaces()).flat().some(row=>row?.address===fixtureBind&&!row.internal);
  if(isIP(fixtureBind)!==4||!privateAddress||!local||!process.env.TEXTTEXT_HTTP_FIXTURE_TOKEN||!/^[a-f0-9]{64}$/.test(fixtureToken))throw Error("LAN fixture requires an explicitly pinned local private interface and isolated token");
  const marker=path.join(path.dirname(root),"fixture-owner.json");const info=lstatSync(marker);
  if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw Error("Invalid fixture ownership marker");
  const owner=JSON.parse(readFileSync(marker,"utf8"));
  if(Object.keys(owner).sort().join(",")!=="bind,nonce,readyFile,root,tokenHash,version"||owner.version!==1||owner.root!==root||owner.readyFile!==readyFile||owner.bind!==fixtureBind||!/^[a-f0-9]{64}$/.test(owner.nonce)||owner.tokenHash!==createHash("sha256").update(fixtureToken).digest("hex"))throw Error("LAN fixture ownership does not match its isolated paths and interface");
}
const fixtureAuthorization = "Bearer " + fixtureToken;
let loseReplies = 0;
let folderCaseEnabled = false;
let raceFolderCase = false;
const folderMetadata = new Map<string, {requestHash:string;status:string}>();
const folderAudits = new Set<string>();
const counts = { uploads: 0, downloads: 0, manifests: 0, renames: 0, deletions: 0, folderRequests: 0, folderPublications: 0, folderRecoveries: 0 };

const fixtureFolderContext={root,workspaceId,actorUserId:"fixture-owner",authorize:async()=>{},
        onReceipt:async(row:{operationId:string})=>{if(!folderAudits.has(row.operationId)){folderAudits.add(row.operationId);counts.folderPublications++;}},
        onFolderMove:async(intent:{operationId:string;requestHash:string},phase:"reserve"|"complete"|"abort")=>{
          const prior=folderMetadata.get(intent.operationId);if(prior&&prior.requestHash!==intent.requestHash)throw Error("Fixture operation changed");
          if(phase==="reserve"&&prior?.status==="aborted")throw Error("Fixture operation aborted");
          if(phase==="reserve"&&prior?.status==="applied")return;
          folderMetadata.set(intent.operationId,{requestHash:intent.requestHash,status:phase==="reserve"?"reserved":phase==="complete"?"applied":"aborted"});
        }};

const server = createServer(async (request, response) => {
  const send = (status: number, value: unknown, headers: Record<string, string> = {}) => {
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
    response.end(JSON.stringify(value));
  };
  if (request.headers.authorization !== fixtureAuthorization) { send(401, { error: "Fixture token required" }); return; }
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/__test/lose-next-reply") { loseReplies = 1; send(200, {}); return; }
  if (url.pathname === "/__test/reply-loss") { loseReplies = url.searchParams.get("enabled") === "1" ? -1 : 0; send(200, {}); return; }
  if (url.pathname === "/__test/folder-case-race") { raceFolderCase = true; send(200, {}); return; }
  if (url.pathname === "/__test/folder-case") { folderCaseEnabled = url.searchParams.get("enabled") === "1"; send(200, {}); return; }
  if (url.pathname === "/__test/restore") {
    if (request.method !== "POST") { send(405, {}); return; }
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) { const bytes = Buffer.from(chunk); if ((size += bytes.length) > 8192) { send(413, {}); return; } chunks.push(bytes); }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (!body || Object.keys(body).sort().join(",") !== "basePath,baseRevision,itemId,operationId,relativePath" || Object.values(body).some(value => typeof value !== "string")) { send(400, {}); return; }
      const result = await restoreVaultTextpack({root, workspaceId, ...body});
      send(result.status === "conflict" ? 409 : 200, result);
    } catch { send(500, {error: "Fixture restore failed"}); }
    return;
  }
  if (url.pathname === "/__test/stats") { send(200, counts); return; }
  if (url.pathname === "/api/vault") { send(200, { workspaceId, name: "Contract fixture" }); return; }
  // Opt-in real engine/HTTP fixture. Metadata coordination here is an isolated
  // in-memory test adapter, not real authentication or PostgreSQL verification.
  if (folderCaseEnabled && (url.pathname === `/api/vault/${workspaceId}/folder-case-moves` || url.pathname === `/api/vault/${workspaceId}/folder-case-moves/recovery`)) {
    if (request.method !== "POST") { send(405, {}); return; }
    try {
      const chunks:Buffer[]=[];let size=0;
      for await (const chunk of request) { const bytes=Buffer.from(chunk);if((size+=bytes.length)>4*1024*1024){send(413,{});return;}chunks.push(bytes); }
      const body=JSON.parse(Buffer.concat(chunks).toString());

      if(url.pathname.endsWith("/recovery")){
        counts.folderRecoveries++;
        const result=await recoverVaultFolderCase({...body.command,...fixtureFolderContext,action:body.action,inspection:body.inspection,
          verifyUncommitted:async()=>{const prior=folderMetadata.get(body.command.operationId);if(prior&&prior.status!=="aborted")throw Error("Fixture metadata recovery pending");},
          auditCancellation:async()=>{}});
        send(200,result);return;
      }
      counts.folderRequests++;
      if(raceFolderCase){raceFolderCase=false;await mkdir(path.join(root,workspaceId,"Concurrent empty folder "+counts.folderRequests),{recursive:true});}
      const result=await moveVaultFolderCase({...body,...fixtureFolderContext,preparePlan:async (current:{folders:string[];items:{itemId:string;relativePath:string;revision:string}[];revision:string})=>planFolderMove({...current,manifestRevision:current.revision,source:body.source,destination:body.destination,grants:[],caseOnly:true})});
      if(loseReplies!==0){if(loseReplies>0)loseReplies--;request.socket.destroy();return;}
      send(200,result);return;
    }catch(error){send(409,{error:error instanceof Error?error.message:"Fixture folder move failed"});return;}
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "vault" || parts[2] !== workspaceId || parts[3] !== "items") {
    send(404, { error: "Fixture workspace not found" }); return;
  }
  const location = { root, workspaceId, ...(folderCaseEnabled ? fixtureFolderContext : {}) };
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
      const etag = `"${manifest.revision}${folderCaseEnabled ? "-folder-case-v1" : ""}"`;
      if (previous === etag) { response.writeHead(304, { ETag: etag }); response.end(); }
      else send(200, {
        ...manifest,
        ...(folderCaseEnabled ? {manifestRevision:manifest.revision,syncCapabilities:["folder-case-moves-v1"]} : {}),
        fullAccess: true,
        canCreateContent: true,
        writableFolders: [],
        items: manifest.items.map((item) => ({ ...item, canEditContent: true })),
        tombstones: manifest.tombstones.map((item) => ({ ...item, canEditContent: true })),
      }, { ETag: etag });
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
      if (loseReplies !== 0) { if (loseReplies > 0) loseReplies--; request.socket.destroy(); return; }
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

server.listen(0, fixtureBind, async () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  // The native harness watches existence, so publish only complete JSON.
  const readyTemporary = `${readyFile}.${process.pid}.tmp`;
  await writeFile(readyTemporary, JSON.stringify({ origin: `http://${fixtureBind}:${address.port}` }));
  await rename(readyTemporary, readyFile);
});
process.once("SIGTERM", () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
