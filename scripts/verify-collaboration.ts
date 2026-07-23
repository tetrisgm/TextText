import { evaluateMultiClientCollaboration } from "@/lib/collab/evaluation";

try {
  console.log(JSON.stringify(evaluateMultiClientCollaboration()));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
