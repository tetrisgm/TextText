"use client";

// Background jobs for the assistant: every submission becomes a tracked job
// so the user can navigate anywhere while work continues, run jobs in
// several contexts at once, and see what is happening from a single list.
// The store is module scope (it outlives component remounts and soft route
// changes); jobs are transient by design, so a full page reload starts the
// list fresh while finished work stays visible in each thread's transcript.

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

let jobs: AssistantJob[] = [];
const listeners = new Set<() => void>();
let jobCounter = 0;

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeAssistantJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function assistantJobs(): AssistantJob[] {
  return jobs;
}

export function runningAssistantJobCount(): number {
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
  notify();
  return id;
}

export function updateAssistantJob(
  id: string,
  patch: Partial<Pick<AssistantJob, "activity" | "status">>,
) {
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
  notify();
}
