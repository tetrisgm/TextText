// Isolated child used by the sync durability tests, never by the application.
import * as fs from "node:fs/promises";
import { pushVaultCollaboration } from "../../src/lib/vault/server-store";
async function main() {
  const [root, payloadFile] = process.argv.slice(2);
  const payload = JSON.parse(await fs.readFile(payloadFile, "utf8"));
  await pushVaultCollaboration({ ...payload, root, onReceipt: async () => {
    process.send?.("committed-before-acknowledgement");
    await new Promise(() => {});
  } });
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
