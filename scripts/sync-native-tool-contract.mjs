#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NATIVE_WORKSPACE_TOOL_CONTRACT } from "../src/lib/ai/native-contract.ts";

const swiftPath = fileURLToPath(
  new URL("../mac/Sources/Write/NativeAI.swift", import.meta.url),
);
const source = readFileSync(swiftPath, "utf8");
const contract = NATIVE_WORKSPACE_TOOL_CONTRACT;
const manifest = JSON.stringify(contract, null, 2)
  .split("\n")
  .map((line) => `        ${line}`)
  .join("\n");
const pattern = /(    private static let agentToolContractJSON = #"""\n)[\s\S]*?(\n        """#)/;

if (!pattern.test(source)) {
  console.error("Native AI tool contract manifest is missing.");
  process.exit(1);
}

const updated = source.replace(pattern, `$1${manifest}$2`);
const checkOnly = process.argv.includes("--check");

if (updated === source) {
  console.log(`Native AI tool contract is current (${contract.length} tools).`);
  process.exit(0);
}

if (checkOnly) {
  console.error(
    `Native AI tool contract is stale. Run node --import tsx scripts/sync-native-tool-contract.mjs.`,
  );
  process.exit(1);
}

writeFileSync(swiftPath, updated);
console.log(`Updated Native AI tool contract (${contract.length} tools).`);
