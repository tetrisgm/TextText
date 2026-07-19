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
      id: "native.live_ai",
      timeoutSeconds: 900,
      command: [
        "swift",
        "test",
        "--package-path",
        "mac",
        "--filter",
        "NativeAIIntegrationProbeTests/testLiveAgentToolSession",
      ],
      environment: { WRITE_LIVE_AI_PROBE: "1" },
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
