"use client";

// Background jobs for the assistant: every submission becomes a tracked job
// so the user can navigate anywhere while work continues, run jobs in
// several contexts at once, and see what is happening from a single list.
// The store is module scope (it outlives component remounts and soft route
// changes) and mirrors a bounded history to localStorage. A full reload can
// therefore show what finished and mark an in-flight request as interrupted,
// instead of making the work disappear while the transcript still exists.

export type AssistantJobStatus = "running" | "done" | "error";

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

const MAX_JOBS = 20;
const STORAGE_KEY = "texttext:assistant-jobs";

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

export function runningAssistantJobCount(): number {
  loadJobs();
  return jobs.reduce(
    (count, job) => (job.status === "running" ? count + 1 : count),
    0,
  );
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
