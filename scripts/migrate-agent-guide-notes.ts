import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { backfillWorkspaceAgentGuides } = await import("../src/lib/store");
  const result = await backfillWorkspaceAgentGuides();

  console.log(
    `AI guide notes: ${result.inserted} inserted across ${result.workspaces} workspaces`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
