import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const { backfillWorkspaceAgentGuides } = await import("../src/lib/store");
const result = await backfillWorkspaceAgentGuides();

console.log(
  `AI guide notes: ${result.inserted} inserted across ${result.workspaces} workspaces`,
);
