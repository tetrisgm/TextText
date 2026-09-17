import { generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { WORKSPACE_TOOL_DEFINITIONS, parseWorkspaceToolInput, workspaceToolModelDescription, workspaceToolModelSchema, type WorkspaceToolName } from "./tools";

/**
 * One sentence in, one existing command out.
 *
 * This is the free-text surface of the agent API: a bot, a Shortcut, or a
 * coding agent sends "star everything about Rust from this week" and gets
 * back the command that does it, with arguments, and the result when it is
 * allowed to run. It adds no capability. The candidates are exactly the
 * commands the calling connection could invoke directly, the arguments are
 * validated by each command's own schema, and execution goes through the
 * same executor, so permissions, staged proposals, and audit are unchanged.
 */

export type CommandPlan = { tool: WorkspaceToolName; arguments: Record<string, unknown>; why: string; confidence: "high" | "medium" | "low" };
export type CommandMapping = { ok: true; plan: CommandPlan } | { ok: false; reason: string; suggestions?: WorkspaceToolName[] };

export type Mapper = (input: { text: string; candidates: WorkspaceToolName[]; context: { itemId?: string; folderPath?: string } }) => Promise<CommandMapping>;

const answerSchema = z
  .object({
    tool: z.string().nullable(),
    arguments: z.record(z.string(), z.unknown()).optional(),
    why: z.string().max(400).optional(),
    confidence: z.enum(["high", "medium", "low"]).optional(),
    reason: z.string().max(400).optional(),
  })
  .passthrough();

function validate(candidates: WorkspaceToolName[], raw: unknown): CommandMapping {
  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "The model did not answer with a command" };
  const answer = parsed.data;
  if (!answer.tool) return { ok: false, reason: answer.reason || answer.why || "No command matches that sentence", suggestions: candidates.slice(0, 5) };
  const tool = candidates.find((name) => name === answer.tool);
  if (!tool) return { ok: false, reason: `"${answer.tool}" is not a command this connection can run`, suggestions: candidates.slice(0, 5) };
  try {
    const args = parseWorkspaceToolInput(tool, answer.arguments ?? {}) as Record<string, unknown>;
    return { ok: true, plan: { tool, arguments: args, why: answer.why ?? "", confidence: answer.confidence ?? "medium" } };
  } catch (error) {
    const detail = error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ") : "invalid arguments";
    return { ok: false, reason: `${tool} was chosen but its arguments do not fit: ${detail}` };
  }
}

/**
 * A model-free reading of the most common sentences, so the surface answers
 * something sensible without a key, and so tests have a deterministic path.
 * Deliberately small: anything it does not recognise goes to the model.
 */
export function heuristicMap(text: string, candidates: WorkspaceToolName[], context: { itemId?: string; folderPath?: string } = {}): CommandMapping | null {
  const sentence = text.trim().replace(/\s+/g, " ");
  const has = (name: WorkspaceToolName) => candidates.includes(name);
  const quoted = sentence.match(/["“](.+?)["”]/)?.[1];
  let match: RegExpMatchArray | null;
  if ((match = sentence.match(/^(?:search|find|look for)\s+(?:my\s+)?(?:reading|articles|feeds?|news)\s+(?:for|about)\s+(.+?)\.?$/i)) && has("search_reading")) {
    return validate(candidates, { tool: "search_reading", arguments: { query: quoted ?? match[1], ...(context.folderPath ? { folder_path: context.folderPath } : {}) }, why: "A search across imported articles", confidence: "high" });
  }
  if ((match = sentence.match(/^(?:search|find|look for)\s+(?:for\s+)?(.+?)\.?$/i)) && has("search")) {
    return validate(candidates, { tool: "search", arguments: { query: quoted ?? match[1] }, why: "A workspace search", confidence: "high" });
  }
  if (/^(?:list|show)\s+(?:my\s+)?(?:folders|sections)\.?$/i.test(sentence) && has("list_folders")) {
    return validate(candidates, { tool: "list_folders", arguments: {}, why: "The folder list", confidence: "high" });
  }
  if (/^(?:list|show)\s+(?:my\s+)?(?:feeds|sources|subscriptions)\.?$/i.test(sentence) && has("list_reading_sources")) {
    return validate(candidates, { tool: "list_reading_sources", arguments: {}, why: "The feeds this workspace follows", confidence: "high" });
  }
  if ((match = sentence.match(/^(?:list|show)\s+(?:the\s+)?(?:items|posts|notes|articles)(?:\s+in\s+(.+?))?\.?$/i)) && has("list_items")) {
    const folder = match[1]?.trim() ?? context.folderPath;
    return validate(candidates, { tool: "list_items", arguments: folder ? { folder_path: folder.replace(/^["“]|["”]$/g, "") } : {}, why: "The items in a folder", confidence: "medium" });
  }
  if ((match = sentence.match(/^(?:open|read|show)\s+(?:item\s+)?([0-9a-f-]{36})\.?$/i)) && has("read_item")) {
    return validate(candidates, { tool: "read_item", arguments: { id: match[1] }, why: "Read one item by id", confidence: "high" });
  }
  if (/^(?:read|open|show)\s+(?:this|it)\.?$/i.test(sentence) && context.itemId && has("read_item")) {
    return validate(candidates, { tool: "read_item", arguments: { id: context.itemId }, why: "Read the item in context", confidence: "high" });
  }
  return null;
}

const SYSTEM = `You map one sentence from a person onto exactly one command from a list, with arguments that fit that command's JSON schema. Answer with JSON only, no prose, in this shape:
{"tool": "<name or null>", "arguments": {...}, "why": "<one short sentence>", "confidence": "high|medium|low"}
Rules: pick a command only when the sentence clearly asks for what it does. If nothing fits, or the sentence would need two commands, answer {"tool": null, "reason": "<why>"}. Never invent ids: use the item id or folder path given as context, or leave them out. Prefer reads over writes when the sentence is ambiguous. Do not put the sentence itself into arguments unless it is the search query or the content to write.`;

function catalogue(candidates: WorkspaceToolName[]): string {
  return candidates
    .map((name) => {
      const definition = WORKSPACE_TOOL_DEFINITIONS[name];
      return `### ${name} (${definition.mutability})\n${workspaceToolModelDescription(name).slice(0, 600)}\nSchema: ${JSON.stringify(workspaceToolModelSchema(name)).slice(0, 1500)}`;
    })
    .join("\n\n");
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** The model-backed mapper. Heuristics first, the model for everything else. */
export function modelMapper(model: LanguageModel | null): Mapper {
  return async ({ text, candidates, context }) => {
    const quick = heuristicMap(text, candidates, context);
    if (quick) return quick;
    if (!model) return { ok: false, reason: "That sentence needs the workspace's AI to interpret, and no AI key is configured. Connect one in Settings, AI.", suggestions: candidates.slice(0, 5) };
    const contextLines = [context.itemId ? `Item in context: ${context.itemId}` : null, context.folderPath ? `Folder in context: ${context.folderPath}` : null].filter(Boolean).join("\n");
    const written = await generateText({
      model,
      system: SYSTEM,
      prompt: `Commands available:\n\n${catalogue(candidates)}\n\n${contextLines ? `${contextLines}\n\n` : ""}Sentence: ${JSON.stringify(text)}`,
      maxOutputTokens: 600,
      temperature: 0,
    });
    const raw = extractJson(written.text);
    if (raw === null) return { ok: false, reason: "The model did not answer with a command" };
    return validate(candidates, raw);
  };
}

export type FreeTextResult =
  | { status: "ran"; plan: CommandPlan; result: unknown }
  | { status: "planned"; plan: CommandPlan; note: string }
  | { status: "unmapped"; reason: string; suggestions?: WorkspaceToolName[] };

/**
 * Map, then run or return the plan. `run` is the surface's own executor,
 * so whatever it enforces (scopes, item-agent limits, staged proposals)
 * applies unchanged.
 */
export async function runFreeTextCommand(input: {
  text: string;
  execute: boolean;
  context: { itemId?: string; folderPath?: string };
  candidates: WorkspaceToolName[];
  mapper: Mapper;
  run: (tool: WorkspaceToolName, args: Record<string, unknown>) => Promise<unknown>;
}): Promise<FreeTextResult> {
  const candidates = input.candidates.filter((name) => name !== "run_command");
  const mapping = await input.mapper({ text: input.text, candidates, context: input.context });
  if (!mapping.ok) return { status: "unmapped", reason: mapping.reason, suggestions: mapping.suggestions };
  const definition = WORKSPACE_TOOL_DEFINITIONS[mapping.plan.tool];
  if (definition.mutability === "write" && !input.execute) {
    return { status: "planned", plan: mapping.plan, note: `${mapping.plan.tool} changes the workspace. Call it with these arguments, or send execute: true.` };
  }
  return { status: "ran", plan: mapping.plan, result: await input.run(mapping.plan.tool, mapping.plan.arguments) };
}
