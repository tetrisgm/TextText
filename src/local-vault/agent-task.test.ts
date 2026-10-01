import { describe, expect, it } from "vitest";
import { MAX_AGENT_TASK_LENGTH, agentTaskMatches, createAgentTask, readAgentTask, resumeAgentTask, updateAgentTask, writeAgentTask } from "./agent-task";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("local item agent task", () => {
  it("keeps each draft fenced by workspace, target, and task id", () => {
    const storage = memoryStorage();
    const first = createAgentTask("/Writing", "Notes/One.textpack", "task-one", 1);
    writeAgentTask(storage, { ...first, prompt: "Edit the ending" });

    expect(readAgentTask(storage, "/Writing", "Notes/One.textpack")?.prompt).toBe("Edit the ending");
    expect(readAgentTask(storage, "/Writing", "Notes/Two.textpack")).toBeNull();
    expect(readAgentTask(storage, "/Reading", "Notes/One.textpack")).toBeNull();
    expect(agentTaskMatches(first, { root: "/Writing", target: "Notes/One.textpack", taskId: "another" })).toBe(false);
  });

  it("resumes the same task instead of replacing its authorization draft", () => {
    const storage = memoryStorage();
    const task = createAgentTask("/Writing", "Notes/One.textpack", "task-one", 1);
    writeAgentTask(storage, { ...task, prompt: "Keep this request", phase: "connecting" });

    expect(resumeAgentTask(storage, task.root, task.target, () => "task-two")).toMatchObject({
      taskId: "task-one", prompt: "Keep this request", phase: "connecting",
    });
  });

  it("rejects a late update from another task and bounds saved text", () => {
    const storage = memoryStorage();
    const task = createAgentTask("/Writing", "Notes/One.textpack", "task-current", 1);
    writeAgentTask(storage, task);

    expect(updateAgentTask(storage, { ...task, taskId: "task-old" }, { prompt: "late" }, 2)).toBeNull();
    const updated = updateAgentTask(storage, task, { prompt: "x".repeat(MAX_AGENT_TASK_LENGTH + 100), phase: "submitted" }, 3);
    expect(updated?.prompt).toHaveLength(MAX_AGENT_TASK_LENGTH);
    expect(readAgentTask(storage, task.root, task.target)?.phase).toBe("submitted");
  });

  it("returns a cancelled submitted task to draft without clearing its prompt", () => {
    const storage = memoryStorage();
    const task = createAgentTask("/Writing", "Notes/One.textpack", "task-current", 1);
    writeAgentTask(storage, { ...task, prompt: "Keep this after Stop", phase: "submitted" });

    expect(updateAgentTask(storage, task, { phase: "draft" }, 2)).toMatchObject({
      prompt: "Keep this after Stop", phase: "draft",
    });
  });
});
