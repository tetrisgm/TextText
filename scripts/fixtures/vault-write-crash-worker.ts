// Separate-process durability fixture. Never imported by the application.
import * as fs from "node:fs/promises";
import { readVaultTextpack, writeVaultTextpack } from "../../src/lib/vault/server-store";

async function main() {
  const [payloadFile, mode] = process.argv.slice(2);
  const payload = JSON.parse(await fs.readFile(payloadFile, "utf8"));
  const bytes = await fs.readFile(payload.bytesFile);
  const pause = async () => {
    process.send?.("committed-before-ack");
    await new Promise(() => {});
  };
  const onReceipt = async (receipt: unknown) => {
    if (mode === "before-audit") await pause();
    await fs.mkdir(payload.auditDirectory, { recursive: true });
    // Matches the production deterministic receipt ID + ON CONFLICT sink:
    // delivery may repeat after lost ACK, durable application happens once.
    const identity = (receipt as { operationId: string }).operationId;
    try {
      await fs.writeFile(`${payload.auditDirectory}/${identity}.json`, JSON.stringify(receipt), { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  };
  const request = { ...payload.request, bytes, onReceipt };
  if (mode === "recover") {
    const current = await readVaultTextpack({ ...payload.request, onReceipt });
    const result = await writeVaultTextpack(request);
    process.send?.({ revision: current?.revision, result });
  } else {
    await writeVaultTextpack(request);
    await pause();
  }
}
void main().catch(error => { console.error(String(error)); process.exitCode = 1; });
