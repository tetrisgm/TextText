"use client";

import { useEffect, useRef } from "react";
import type { AssistantMessage } from "./useNativeAssistant";
import type { AssistantJob } from "@/lib/ai/jobs";
import type { AssistantSkill } from "@/lib/ai/skills";
import type { NativeAICapabilities } from "@/lib/ai/native";
import styles from "./AssistantConversation.module.css";

// The transcript inside the assistant sidebar: user and assistant turns,
// lightweight progress rows while the on-device model drives tools, a jobs
// strip so background work stays visible from anywhere, and an empty state
// that says where the answers come from and which writing skills are active.
export function AssistantConversation({
  capabilities,
  jobs,
  messages,
  skills,
  submitting,
  onOpenJob,
  onToggleSkill,
}: {
  capabilities: NativeAICapabilities | null;
  jobs?: AssistantJob[];
  messages: AssistantMessage[];
  skills?: Array<AssistantSkill & { enabled: boolean }>;
  submitting: boolean;
  onOpenJob?: (job: AssistantJob) => void;
  onToggleSkill?: (skillId: string, enabled: boolean) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, submitting]);

  const visibleJobs = (jobs ?? []).slice(0, 6);
  const jobsStrip =
    visibleJobs.length > 0 ? (
      <div className={styles.jobs} aria-label="Assistant jobs">
        {visibleJobs.map((job) => (
          <button
            key={job.id}
            type="button"
            className={styles.jobRow}
            data-status={job.status}
            title={`${job.label} (${job.contextLabel})`}
            onClick={() => onOpenJob?.(job)}
          >
            <span className={styles.jobDot} aria-hidden="true" />
            <span className={styles.jobCopy}>
              <span className={styles.jobLabel}>{job.label}</span>
              <span className={styles.jobMeta}>
                {job.contextLabel}
                {job.status === "running"
                  ? ` · ${job.activity ?? "Working"}`
                  : job.status === "error"
                    ? " · Failed"
                    : " · Done"}
              </span>
            </span>
          </button>
        ))}
      </div>
    ) : null;

  if (messages.length === 0) {
    return (
      <div className={styles.empty}>
        {jobsStrip}
        <p className={styles.emptyTitle}>
          {capabilities?.available
            ? "Private, on this Mac"
            : "Ask about your workspace"}
        </p>
        <p className={styles.emptyBody}>
          {capabilities?.available
            ? "Answers and edits run on Apple's on-device model. Nothing leaves this Mac, and it works offline."
            : "Inside the Mac app, the assistant runs on Apple's on-device model: private, offline, free."}
        </p>
        <ul className={styles.examples}>
          <li>Give this post a better title</li>
          <li>Summarize this article</li>
          <li>Create three draft posts about...</li>
        </ul>
        {skills && skills.length > 0 && (
          <div className={styles.skills}>
            <p className={styles.skillsHeading}>Skills</p>
            {skills.map((skill) => (
              <label className={styles.skillRow} key={skill.id}>
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  disabled={!onToggleSkill}
                  onChange={(event) =>
                    onToggleSkill?.(skill.id, event.currentTarget.checked)
                  }
                />
                <span className={styles.skillCopy}>
                  <span className={styles.skillName}>{skill.name}</span>
                  <span className={styles.skillDescription}>
                    {skill.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.thread} aria-live="polite">
      {jobsStrip}
      {messages.map((message) => {
        if (message.role === "progress") {
          return (
            <div key={message.id} className={styles.progress}>
              {message.text}
            </div>
          );
        }
        return (
          <div
            key={message.id}
            className={
              message.role === "user"
                ? styles.userTurn
                : message.role === "error"
                  ? styles.errorTurn
                  : styles.assistantTurn
            }
          >
            {message.text}
          </div>
        );
      })}
      {submitting && <div className={styles.progress}>Thinking on this Mac</div>}
      <div ref={endRef} />
    </div>
  );
}
