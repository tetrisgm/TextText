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

describe("cloudTurnOutcome", () => {
  it("is Done only when every command that ran worked", async () => {
    const { cloudTurnOutcome } = await import("../jobs");
    expect(
      cloudTurnOutcome({
        workspaceCalls: [
          { tool: "search", status: "ok" },
          { tool: "create_item", status: "ok" },
        ],
      }),
    ).toEqual({ status: "done", errors: [] });
  });

  it("is not Done when the change the person asked for failed", async () => {
    // The turn completed and the model answered. The note was never created,
    // and "Done" over that is how somebody believes a note exists.
    const { cloudTurnOutcome } = await import("../jobs");
    expect(
      cloudTurnOutcome({
        workspaceCalls: [
          { tool: "search", status: "ok" },
          {
            tool: "create_item",
            status: "failed",
            error: 'Kind "note" does not belong in "blog".',
          },
        ],
      }),
    ).toEqual({
      status: "error",
      activity: "Nothing changed",
      errors: ['Kind "note" does not belong in "blog".'],
    });
  });

  it("counts more than one failure rather than naming only the last", async () => {
    const { cloudTurnOutcome } = await import("../jobs");
    const outcome = cloudTurnOutcome({
      workspaceCalls: [
        { tool: "create_item", status: "failed", error: "First refusal." },
        { tool: "update_item", status: "failed", error: "Second refusal." },
      ],
    });
    expect(outcome.status).toBe("error");
    expect(outcome.activity).toBe("Nothing changed (2 commands failed)");
    expect(outcome.errors).toEqual(["First refusal.", "Second refusal."]);
  });

  it("falls back to naming the command when it reported no message", async () => {
    const { cloudTurnOutcome } = await import("../jobs");
    expect(
      cloudTurnOutcome({
        workspaceCalls: [{ tool: "create_item", status: "failed" }],
      }).errors,
    ).toEqual(["create_item did not complete."]);
  });

  it("keeps a terminal provider error ahead of command failures", async () => {
    const { cloudTurnOutcome } = await import("../jobs");
    expect(
      cloudTurnOutcome({
        terminalError: "The provider stopped responding.",
        workspaceCalls: [{ tool: "create_item", status: "failed" }],
      }),
    ).toEqual({
      status: "error",
      activity: "The provider stopped responding.",
      errors: ["The provider stopped responding."],
    });
  });

  it("treats a call with no status as one that worked", async () => {
    const { cloudTurnOutcome } = await import("../jobs");
    expect(
      cloudTurnOutcome({ workspaceCalls: [{ tool: "search" }] }).status,
    ).toBe("done");
  });
});

describe("what the jobs strip lists", () => {
  const job = (id: string, threadKey: string, status: string) =>
    ({ id, threadKey, status }) as never;

  it("drops the thread on screen, whatever that turn is doing", async () => {
    const { jobsForOtherThreads } = await import("../jobs");
    const here = "blog\u001fconversation-1";
    expect(
      jobsForOtherThreads(
        [job("a", here, "running"), job("b", here, "done"), job("c", here, "error")],
        here,
      ),
    ).toEqual([]);
  });

  it("keeps work started somewhere else, which is what the strip is for", async () => {
    const { jobsForOtherThreads } = await import("../jobs");
    const here = "blog\u001fconversation-1";
    const elsewhere = job("d", "blog\u001fconversation-2", "running");
    expect(jobsForOtherThreads([job("a", here, "running"), elsewhere], here)).toEqual([
      elsewhere,
    ]);
  });
});
