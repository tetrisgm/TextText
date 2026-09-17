import { modelMapper } from "../free-text-command.server";
import type { CommandMapping } from "../free-text-command.server";
import type { WorkspaceToolName } from "../tools";

/** Feed a canned model answer through the real validation path. */
export async function validateForTest(candidates: WorkspaceToolName[], answer: unknown): Promise<CommandMapping> {
  const fake = { doGenerate: async () => ({ content: [{ type: "text", text: JSON.stringify(answer) }], finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [] }), specificationVersion: "v3", provider: "fake", modelId: "fake", supportedUrls: {} } as never;
  return modelMapper(fake)({ text: "zzz not a heuristic sentence zzz", candidates, context: {} });
}
