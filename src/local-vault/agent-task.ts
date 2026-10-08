export const REQUEST_ADD_ITEM_AGENT_EVENT = "texttext:vault-request-add-agent";

export const MAX_AGENT_TASK_LENGTH = 12_000;
const MAX_STORED_TASK_LENGTH = 20_000;
const PREFIX = "texttext:agent-task:";

export type AgentTaskPhase = "draft" | "connecting" | "submitted";
export type AgentTask = {
  imageAssetId?: string;
  version: 1;
  taskId: string;
  root: string;
  target: string;
  prompt: string;
  phase: AgentTaskPhase;
  updatedAt: number;
};
export type AgentTaskFence = Pick<AgentTask, "root" | "target" | "taskId">;

function boundedText(value: unknown, limit: number): string | null {
  if (typeof value !== "string" || /[\u0000]/.test(value)) return null;
  return value.slice(0, limit);
}

function storageKey(root: string, target: string) {
  return `${PREFIX}${encodeURIComponent(root)}:${encodeURIComponent(target)}`;
}

function cleanTask(value: unknown, root: string, target: string): AgentTask | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AgentTask>;
  const taskId = boundedText(candidate.taskId, 128);
  const savedRoot = boundedText(candidate.root, 4096);
  const savedTarget = boundedText(candidate.target, 4096);
  const prompt = boundedText(candidate.prompt, MAX_AGENT_TASK_LENGTH);
  if (candidate.imageAssetId !== undefined && (typeof candidate.imageAssetId !== "string" || !candidate.imageAssetId || candidate.imageAssetId.length > 120)) return null;
  if (candidate.version !== 1 || !taskId || savedRoot !== root || savedTarget !== target || prompt === null ||
      !["draft", "connecting", "submitted"].includes(candidate.phase ?? "") ||
      typeof candidate.updatedAt !== "number" || !Number.isFinite(candidate.updatedAt)) return null;
  return { version: 1, taskId, root, target, prompt, phase: candidate.phase as AgentTaskPhase, updatedAt: candidate.updatedAt, ...(candidate.imageAssetId ? { imageAssetId: candidate.imageAssetId } : {}) };
}

export function readAgentTask(storage: Pick<Storage, "getItem">, root: string, target: string): AgentTask | null {
  try {
    const raw = storage.getItem(storageKey(root, target));
    if (!raw || raw.length > MAX_STORED_TASK_LENGTH) return null;
    return cleanTask(JSON.parse(raw), root, target);
  } catch {
    return null;
  }
}

export function createAgentTask(root: string, target: string, taskId: string, updatedAt = Date.now()): AgentTask {
  const cleanRoot = boundedText(root, 4096), cleanTarget = boundedText(target, 4096), cleanId = boundedText(taskId, 128);
  if (!cleanRoot || !cleanTarget || !cleanId) throw new Error("Choose an open item before adding an agent.");
  return { version: 1, taskId: cleanId, root: cleanRoot, target: cleanTarget, prompt: "", phase: "draft", updatedAt };
}

export function writeAgentTask(storage: Pick<Storage, "setItem">, task: AgentTask) {
  storage.setItem(storageKey(task.root, task.target), JSON.stringify({ ...task, prompt: task.prompt.slice(0, MAX_AGENT_TASK_LENGTH) }));
}

export function resumeAgentTask(
  storage: Pick<Storage, "getItem" | "setItem">,
  root: string,
  target: string,
  createId: () => string,
): AgentTask {
  const saved = readAgentTask(storage, root, target);
  if (saved) return saved;
  const created = createAgentTask(root, target, createId());
  writeAgentTask(storage, created);
  return created;
}

export function agentTaskMatches(task: AgentTask | null, fence: AgentTaskFence): task is AgentTask {
  return Boolean(task && task.root === fence.root && task.target === fence.target && task.taskId === fence.taskId);
}

export function updateAgentTask(
  storage: Pick<Storage, "getItem" | "setItem">,
  fence: AgentTaskFence,
  change: Partial<Pick<AgentTask, "prompt" | "phase" | "imageAssetId">>,
  updatedAt = Date.now(),
): AgentTask | null {
  const current = readAgentTask(storage, fence.root, fence.target);
  if (!agentTaskMatches(current, fence)) return null;
  const next = { ...current, ...change, prompt: (change.prompt ?? current.prompt).slice(0, MAX_AGENT_TASK_LENGTH), updatedAt };
  writeAgentTask(storage, next);
  return next;
}

/** A title belongs to its file, never to whichever item is currently selected. */
export function agentTaskTitle(target: string, current?: { path: string; title: string }): string {
  return (current?.path === target ? current.title.trim() : "") || target.split("/").at(-1)?.replace(/\.textpack$/i, "") || "Open item";
}
