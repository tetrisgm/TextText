import { it, expect } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { ensureVaultFolders, writeVaultTextpack, moveVaultFolderCase, listVaultTextpacks } from "./store";
import { planFolderMove } from "./folder-move-plan";

it("propagates an ordinary external case-only folder move without contradictory authoritative aliases", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TEXTTEXT_PROPAGATION_ROOT ?? os.tmpdir(), "texttext-folder-propagation-red-"));
  const workspaceId = "folder-propagation-workspace", itemId = "folder-propagation-item";
  const sourceFolder = "Six-client acceptance folder Case 211", destinationFolder = "Six-client acceptance folder CASE 211";
  const filename = "Six-client acceptance propagation 211.textpack";
  const document = emptyDocumentSnapshot(); document.content.body = "Retained baseline and empty descendant";
  const bytes = buildTextpack("Six-client acceptance propagation 211", { document,
    markdown: `---\ntextTextId: ${JSON.stringify(itemId)}\n---\n\n${document.content.body}`,
    files: { "assets/exact.bin": new Uint8Array([0,255,19,72]) } });
  await ensureVaultFolders({root,workspaceId}, [sourceFolder, `${sourceFolder}/Empty child`]);
  await writeVaultTextpack({root,workspaceId,itemId,operationId:"folder-propagation-create",relativePath:`${sourceFolder}/${filename}`,baseRevision:null,bytes});
  const before = await listVaultTextpacks({root,workspaceId});

  const context={root,workspaceId,onReceipt:async()=>{},onFolderMove:async()=>{}};
  const moved = await moveVaultFolderCase({...context,operationId:"folder-propagation-tree-move",source:sourceFolder,destination:destinationFolder,
    baseManifestRevision:before.revision,folders:before.folders,items:before.items.map(({itemId,relativePath,revision})=>({itemId,relativePath,revision})),actorUserId:"owner",authorize:async()=>{},
    preparePlan:async current=>planFolderMove({...current,manifestRevision:current.revision,source:sourceFolder,destination:destinationFolder,caseOnly:true,grants:[]})});
  expect(moved.status).toBe("moved");
  const after = await listVaultTextpacks({root,workspaceId});
  const fixture = {root,workspaceId,itemId,sourceFolder,destinationFolder,filename,before,after,bytesBase64:Buffer.from(bytes).toString("base64")};
  const proof = process.env.TEXTTEXT_PROPAGATION_PROOF ?? path.join(os.tmpdir(),"texttext-folder-propagation-red-manifest.json");
  await fs.writeFile(proof,JSON.stringify(fixture,null,2));
  console.log("Folder propagation evidence", proof, "retained server scratch", root);
  expect(after.items.filter(item=>item.itemId===itemId).map(item=>item.relativePath)).toEqual([`${destinationFolder}/${filename}`]);
  expect(after.folders).toEqual([destinationFolder, `${destinationFolder}/Empty child`]);
});
