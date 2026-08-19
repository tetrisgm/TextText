import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  formatDuration,
  readAndValidateReleaseReceipt,
  releaseReceiptPath,
  repositoryRoot,
  runMeasuredCommand,
  sourceIdentity,
  type CommandReceipt,
  type ReleaseGateReceipt,
} from "./work-unit";

const args = new Set(process.argv.slice(2));
type CommandEnvironment = Record<string, string | undefined>;

async function verifyRelease() {
  if (args.has("--check")) {
    const receipt = readAndValidateReleaseReceipt(repositoryRoot);
    console.log(
      `Release gates already passed in ${formatDuration(receipt.totalDurationMilliseconds)}.`,
    );
    return;
  }

  const checks: Array<{
    id: string;
    timeoutSeconds: number;
    command: string[];
    environment?: CommandEnvironment;
  }> = [
    {
      id: "web.types",
      timeoutSeconds: 600,
      command: ["npx", "tsc", "--noEmit"],
    },
    {
      id: "workflow.document_engine",
      timeoutSeconds: 300,
      command: ["npx", "tsx", "scripts/verify-document-engine.ts"],
    },
    {
      id: "workflow.canonical_documents",
      timeoutSeconds: 300,
      command: ["npx", "tsx", "scripts/audit-canonical-documents.ts"],
    },
    {
      id: "workflow.collaboration",
      timeoutSeconds: 120,
      command: ["npx", "tsx", "scripts/verify-collaboration.ts"],
    },
    {
      id: "workflow.client_reliability",
      timeoutSeconds: 180,
      command: ["npx", "tsx", "scripts/verify-client-reliability.ts"],
    },
    {
      id: "workflow.agent_interoperability",
      timeoutSeconds: 120,
      command: ["npx", "tsx", "scripts/verify-agent-interoperability.ts"],
    },
    {
      // Catch a stale health-check manifest here rather than during a ship.
      // The release gate and the Swift test both read it, so drift used to
      // surface one failed release at a time.
      id: "native.health_manifest",
      timeoutSeconds: 60,
      command: ["npx", "tsx", "scripts/sync-health-checks.ts", "--check"],
    },
    {
      // The tool lists in the Markdown docs are generated from the registry.
      // Hand-maintained copies drifted far enough to name tools that no longer
      // existed, so an agent following the docs would have called nothing.
      id: "docs.tool_lists",
      timeoutSeconds: 60,
      command: ["npx", "tsx", "scripts/sync-tool-docs.ts", "--check"],
    },
    {
      // Every migration on disk must be in the release order. Two were not,
      // so a freshly provisioned database would have been missing columns the
      // schema declares. This fails long before a new environment does.
      id: "db.migration_coverage",
      timeoutSeconds: 60,
      command: ["scripts/run-release-migrations.sh", "--check"],
    },
    {
      // Every built-in template must render to real HTML with representative
      // content, and every composed node must leave markup. Schema validation
      // alone let 23 templates ship with one ever seen on a screen.
      id: "workflow.template_render",
      timeoutSeconds: 120,
      command: ["npx", "tsx", "scripts/verify-template-render.ts"],
    },
    {
      // Dead references, unreachable scripts, and finished plans still sitting
      // in docs/ as if they were current work. Every one of those has cost a
      // real cycle here, so they fail the release now instead.
      id: "docs.no_rot",
      timeoutSeconds: 120,
      command: ["npx", "tsx", "scripts/verify-docs.ts"],
    },
    {
      id: "workflow.agent_integrations",
      timeoutSeconds: 60,
      command: ["npm", "run", "verify:agent-integrations"],
    },
    {
      id: "workflow.live_clients",
      timeoutSeconds: 900,
      command: ["npm", "run", "eval:clients:live"],
    },
    {
      id: "web.unit",
      timeoutSeconds: 1_800,
      command: ["npx", "vitest", "run"],
    },
    {
      id: "native.unit",
      timeoutSeconds: 2_400,
      command: ["swift", "test", "--package-path", "mac"],
    },
    {
      // The private promotion lane must never drift into a publishing command,
      // reuse a build identity, or leave the canonical install unrecoverable.
      // Fixture tests force both health and Trash-cleanup rollback failures.
      id: "native.local_promotion",
      timeoutSeconds: 60,
      command: ["npm", "run", "promote:local:test"],
    },
    {
      // TestFlight packaging is a separate channel from local promotion. Its
      // fixture proves that only a sandboxed Apple Distribution app with a
      // positive build number can become a signed installer package.
      id: "native.testflight_package",
      timeoutSeconds: 60,
      command: ["npm", "run", "testflight:build:test"],
    },
    {
      id: "apple.eval",
      timeoutSeconds: 600,
      command: ["mac/scripts/apple-plan-eval.sh", "--skip-tests"],
    },
  ];

  const commandReceipts: CommandReceipt[] = [];
  for (const check of checks) {
    commandReceipts.push(
      await runMeasuredCommand({
        root: repositoryRoot,
        name: check.id,
        command: check.command,
        timeoutSeconds: check.timeoutSeconds,
        environment: check.environment,
      }),
    );
  }
  const identity = sourceIdentity(repositoryRoot);
  if (
    commandReceipts.some(
      (receipt) =>
        receipt.sourceCommit !== identity.sourceCommit ||
        receipt.sourceFingerprint !== identity.sourceFingerprint,
    )
  ) {
    throw new Error("Source changed while release gates were running. Run them again.");
  }
  const receipt: ReleaseGateReceipt = {
    schemaVersion: 1,
    ...identity,
    generatedAt: new Date().toISOString(),
    totalDurationMilliseconds: commandReceipts.reduce(
      (sum, check) => sum + check.durationMilliseconds,
      0,
    ),
    checks: commandReceipts.map((check) => ({
      id: check.name,
      status: "pass",
      durationMilliseconds: check.durationMilliseconds,
      reused: check.reused,
      commandFingerprint: check.commandFingerprint,
    })),
  };
  const path = releaseReceiptPath(repositoryRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  readAndValidateReleaseReceipt(repositoryRoot);
  console.log(
    `Release gates passed in ${formatDuration(receipt.totalDurationMilliseconds)}.`,
  );
  console.log(path);
}

verifyRelease().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
