"use client";

// Background jobs for the assistant: every submission becomes a tracked job
// so the user can navigate anywhere while work continues, run jobs in
// several contexts at once, and see what is happening from a single list.
// The store is module scope (it outlives component remounts and soft route
// changes) and mirrors a bounded history to localStorage. A full reload can
// therefore show what finished and mark an in-flight request as interrupted,
// instead of making the work disappear while the transcript still exists.

type AssistantJobStatus = "running" | "done" | "error";

export type AssistantJob = {
  id: string;
  /** Thread the job reports into (handle:contextKey). */
  threadKey: string;
  /** Context key (item:<id> or place:<url>) for click-to-navigate. */
  contextKey: string;
  /** Where the job was started, for the list ("Blog", a post title...). */
  contextLabel: string;
  /** First words of the prompt. */
  label: string;
  status: AssistantJobStatus;
  /** Latest progress line while running ("Creating an item"). */
  activity?: string;
  startedAt: number;
  finishedAt?: number;
};

/**
 * How a finished cloud turn should be reported.
 *
 * A turn that completed is not the same as a change that happened. A create the
 * executor refused used to leave the job labelled Done, and the only account of
 * the failure on screen was the model's prose retelling of the command's error.
 * The label follows the change; the errors are the executor's own words.
 */
export function cloudTurnOutcome(result: {
  terminalError?: string;
  workspaceCalls: ReadonlyArray<{
    tool: string;
    status?: "ok" | "failed";
    error?: string;
  }>;
}): { status: AssistantJobStatus; activity?: string; errors: string[] } {
  if (result.terminalError) {
    return {
      status: "error",
      activity: result.terminalError,
      errors: [result.terminalError],
    };
  }
  const failed = result.workspaceCalls.filter(
    (call) => call.status === "failed",
  );
  if (failed.length === 0) return { status: "done", errors: [] };
  return {
    status: "error",
    activity:
      failed.length === 1
        ? "Nothing changed"
        : `Nothing changed (${failed.length} commands failed)`,
    errors: failed.map(
      (call) => call.error ?? `${call.tool} did not complete.`,
    ),
  };
}

/**
 * The jobs worth listing above a conversation.
 *
 * The strip exists so work stays visible from anywhere, which means work the
 * person cannot otherwise see. A turn running in the thread on screen reports
 * itself inline, under the message that started it, and its outcome lands in
 * the transcript; listing it again at the top announced the work in the one
 * place the person was not looking, and became the only sign of it when the
 * inline line scrolled away. The launcher's count still covers every job.
 */
export function jobsForOtherThreads<Job extends { threadKey: string }>(
  jobs: readonly Job[],
  threadKey: string,
): Job[] {
  return jobs.filter((job) => job.threadKey !== threadKey);
}

/**
 * How long a finished job stays in the strip. Long enough to be seen by
 * someone returning from another part of the workspace, short enough that
 * the strip never becomes a permanent ledger of every old failure.
 */
export const FINISHED_JOB_LISTING_MS = 5 * 60_000;

/**
 * A finished job's outcome already lives in its own thread's transcript, so
 * the strip lists it only briefly as a "this finished while you were away"
 * notice. Before this rule, up to twenty done and failed jobs from past
 * sessions sat pinned above every conversation with red dots, and the rail
 * opened on a wall of stale alarms instead of the person's own chat.
 */
export function jobsWorthListing<
  Job extends { threadKey: string; status: string; finishedAt?: number },
>(jobs: readonly Job[], threadKey: string, now = Date.now()): Job[] {
  return jobsForOtherThreads(jobs, threadKey).filter(
    (job) =>
      job.status === "running" ||
      (job.finishedAt ?? 0) > now - FINISHED_JOB_LISTING_MS,
  );
}

const MAX_JOBS = 20;
const STORAGE_KEY = "texttext:assistant-jobs";
const EMPTY_SERVER_JOBS: AssistantJob[] = [];
const PROGRESS_ACTIVITY =
  /^(Contacting |Connected to |Finished |Thinking$|Using |Working)/;

let jobs: AssistantJob[] = [];
let loaded = false;
const listeners = new Set<() => void>();
let jobCounter = 0;

function loadJobs() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return;
    const restored = parsed.flatMap((entry): AssistantJob[] => {
      if (!entry || typeof entry !== "object") return [];
      const candidate = entry as Partial<AssistantJob>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.threadKey !== "string" ||
        typeof candidate.contextKey !== "string" ||
        typeof candidate.contextLabel !== "string" ||
        typeof candidate.label !== "string" ||
        (candidate.status !== "running" &&
          candidate.status !== "done" &&
          candidate.status !== "error") ||
        typeof candidate.startedAt !== "number"
      ) {
        return [];
      }
      return [
        candidate.status === "running"
          ? {
              ...candidate,
              status: "error",
              activity: "Interrupted when TextText closed.",
              finishedAt: Date.now(),
            } as AssistantJob
          : candidate.status === "error" &&
              (!candidate.activity || PROGRESS_ACTIVITY.test(candidate.activity))
            ? ({ ...candidate, activity: "Failed" } as AssistantJob)
            : (candidate as AssistantJob),
      ];
    });
    jobs = restored.slice(0, MAX_JOBS);
    persistJobs();
  } catch {
    // Private browsing or malformed state should not block the assistant.
  }
}

function persistJobs() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    // Quota or private mode: the in-memory list remains useful.
  }
}

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeAssistantJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function assistantJobs(): AssistantJob[] {
  loadJobs();
  return jobs;
}

/** Stable empty snapshot used for SSR and the first hydration render. */
export function serverAssistantJobs(): AssistantJob[] {
  return EMPTY_SERVER_JOBS;
}

export function startAssistantJob(input: {
  threadKey: string;
  contextKey: string;
  contextLabel: string;
  prompt: string;
}): string {
  loadJobs();
  jobCounter += 1;
  const id = `job${Date.now().toString(36)}_${jobCounter}`;
  const label =
    input.prompt.length > 64 ? `${input.prompt.slice(0, 64)}...` : input.prompt;
  const job: AssistantJob = {
    id,
    threadKey: input.threadKey,
    contextKey: input.contextKey,
    contextLabel: input.contextLabel,
    label,
    status: "running",
    startedAt: Date.now(),
  };
  jobs = [job, ...jobs].slice(0, MAX_JOBS);
  persistJobs();
  notify();
  return id;
}

export function updateAssistantJob(
  id: string,
  patch: Partial<Pick<AssistantJob, "activity" | "status">>,
) {
  loadJobs();
  jobs = jobs.map((job) =>
    job.id === id
      ? {
          ...job,
          ...patch,
          activity:
            patch.activity ??
            (patch.status === "error" ? "Failed" : job.activity),
          finishedAt:
            patch.status && patch.status !== "running"
              ? Date.now()
              : job.finishedAt,
        }
      : job,
  );
  persistJobs();
  notify();
}
