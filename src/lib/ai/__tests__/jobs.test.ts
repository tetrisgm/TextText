import { afterEach, describe, expect, it, vi } from "vitest";

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("assistant job history", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("persists completed jobs and marks in-flight work interrupted on reload", async () => {
    const localStorage = fakeStorage();
    vi.stubGlobal("window", { localStorage });
    const first = await import("../jobs");
    expect(first.serverAssistantJobs()).toBe(first.serverAssistantJobs());
    expect(first.serverAssistantJobs()).toEqual([]);
    const id = first.startAssistantJob({
      threadKey: "writer:root",
      contextKey: "place:/@writer",
      contextLabel: "Workspace",
      prompt: "Catch me up",
    });
    first.updateAssistantJob(id, { status: "done", activity: "Finished" });
    first.startAssistantJob({
      threadKey: "writer:item:one",
      contextKey: "item:one",
      contextLabel: "Launch note",
      prompt: "Rewrite this",
    });
    const staleError = first.startAssistantJob({
      threadKey: "writer:item:two",
      contextKey: "item:two",
      contextLabel: "Old note",
      prompt: "Summarize this",
    });
    first.updateAssistantJob(staleError, {
      status: "error",
      activity: "Thinking",
    });

    vi.resetModules();
    const second = await import("../jobs");
    const jobs = second.assistantJobs();
    expect(jobs).toHaveLength(3);
    expect(jobs.find((job) => job.id === id)?.status).toBe("done");
    expect(jobs.find((job) => job.contextKey === "item:one")).toMatchObject({
      status: "error",
      activity: "Interrupted when TextText closed.",
    });
    expect(jobs.find((job) => job.contextKey === "item:two")).toMatchObject({
      status: "error",
      activity: "Failed",
    });
  });
});
