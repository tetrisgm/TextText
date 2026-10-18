import { afterEach, describe, expect, it } from "vitest";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { writeVaultTextpack } from "./server-store";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function child(payloadFile: string, mode: string) {
  return fork(path.resolve("scripts/fixtures/vault-write-crash-worker.ts"), [payloadFile, mode], {
    execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
}
async function message(process: ReturnType<typeof child>) {
  const timeout = setTimeout(() => process.kill("SIGKILL"), 20_000);
  try {
    return await Promise.race([
      once(process, "message").then(([value]) => value),
      once(process, "exit").then(([code, signal]) => { throw new Error(`Fixture exited before message: ${code}/${signal}`); }),
    ]);
  } finally { clearTimeout(timeout); }
}

describe("separate-process file write receipt recovery", () => {
  for (const boundary of ["before-audit", "after-audit"] as const) {
    it(`recovers exact bytes and one receipt after SIGKILL ${boundary}`, async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-write-crash-")); roots.push(root);
      const document = emptyDocumentSnapshot(); document.content.body = "Keep acknowledged Unicode 🦊 and assets";
      const bytes = buildTextpack("Crash fixture", { document,
        markdown: '---\ntextTextId: crash-item\n---\n\nKeep acknowledged Unicode 🦊 and assets',
        files: { "assets/exact.bin": new Uint8Array([0, 255, 17, 44]) },
      });
      const bytesFile = path.join(root, "payload.textpack"), auditDirectory = path.join(root, "audit");
      await fs.writeFile(bytesFile, bytes);
      const request = { root: path.join(root, "vault"), workspaceId: "crash-workspace", itemId: "crash-item",
        operationId: "crash-write", relativePath: "Notes/Crash.textpack", baseRevision: null,
        audit: { actorUserId: "crash-actor", actorType: "human" as const } };
      const payloadFile = path.join(root, "request.json");
      await fs.writeFile(payloadFile, JSON.stringify({ request, bytesFile, auditDirectory }));
      const writer = child(payloadFile, boundary);
      try {
        expect(await message(writer)).toBe("committed-before-ack");
      } finally {
        const exited = once(writer, "exit"); writer.kill("SIGKILL"); await exited;
      }
      const recovery = child(payloadFile, "recover");
      const recovered = await message(recovery);
      const [exit] = await once(recovery, "exit"); expect(exit).toBe(0);
      expect(recovered).toMatchObject({ revision: digest(bytes), result: { status: "written", revision: digest(bytes) } });
      expect(await fs.readFile(path.join(request.root, request.workspaceId, request.relativePath))).toEqual(Buffer.from(bytes));
      const receipts = await Promise.all((await fs.readdir(auditDirectory)).map(async file => JSON.parse(await fs.readFile(path.join(auditDirectory, file), "utf8"))));
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({ operationId: request.operationId, actorUserId: "crash-actor" });
      await expect(writeVaultTextpack({ ...request, onReceipt: async () => { throw new Error("Changed operation reached the audit sink"); }, bytes: buildTextpack("Changed", { document, markdown: '---\ntextTextId: crash-item\n---\n\nChanged bytes' }) })).rejects.toThrow("reused");
    });
  }
});
