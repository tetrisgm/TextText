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
  it("separates folder drafts from item drafts and preserves the workspace-root folder", () => {
    const storage = memoryStorage();
    const item = createAgentTask("/Workspace", "Notes", "item");
    const folder = createAgentTask("/Workspace", "Notes", "folder", 1, "folder");
    writeAgentTask(storage, { ...item, prompt: "Edit this item" });
    writeAgentTask(storage, { ...folder, prompt: "Create notes here" });
    expect(readAgentTask(storage, item.root, item.target)?.prompt).toBe("Edit this item");
    expect(resumeAgentTask(storage, folder.root, folder.target, () => "other", "folder")).toMatchObject({ taskId: "folder", prompt: "Create notes here", scope: "folder" });
    expect(agentTaskMatches(folder, { ...folder, scope: "item" })).toBe(false);
    expect(updateAgentTask(storage, { ...folder, scope: "item" }, { prompt: "wrong scope" })).toBeNull();
    expect(updateAgentTask(storage, folder, { imageAssetId: "item-photo" })).toBeNull();
    const root = createAgentTask("/Workspace", "", "root-folder", 1, "folder");
    writeAgentTask(storage, root);
    expect(readAgentTask(storage, root.root, "", "folder")?.taskId).toBe("root-folder");
  });
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

import { agentTaskTitle, agentTaskTargetArguments } from "./agent-task";
it("sends folder boundaries separately from item paths, including the workspace root", () => {
  expect(agentTaskTargetArguments({ target: "Notes", scope: "folder" })).toEqual({ scope: "folder", folderPath: "Notes" });
  expect(agentTaskTargetArguments({ target: "", scope: "folder" })).toEqual({ scope: "folder", folderPath: "" });
  expect(agentTaskTargetArguments({ target: "Notes/A.textpack" })).toEqual({ scope: "item", path: "Notes/A.textpack" });
});
it("restores the selected photo with its item task and preserves it through phase changes", () => {
  const storage = memoryStorage(), task = createAgentTask("/Photos", "Gallery/A.textpack", "photo-task");
  writeAgentTask(storage, { ...task, imageAssetId: "selected-photo", prompt: "Describe it" });
  expect(resumeAgentTask(storage, task.root, task.target, () => "new")).toMatchObject({ imageAssetId: "selected-photo", prompt: "Describe it" });
  expect(updateAgentTask(storage, task, { phase: "submitted" })).toMatchObject({ imageAssetId: "selected-photo" });
  expect(readAgentTask(storage, "/Other", task.target)).toBeNull();
});
it("uses saved target title without relabeling a running task after selection changes", () => {
  expect(agentTaskTitle("Notes/Untitled5.textpack", { path: "Notes/Untitled5.textpack", title: "Saved note title" })).toBe("Saved note title");
  expect(agentTaskTitle("Notes/Untitled5.textpack", { path: "Notes/Other.textpack", title: "Other saved title" })).toBe("Untitled5");
});
