"use client";

import { useEffect, useRef, useState } from "react";
import type { AssistantMessage } from "./useNativeAssistant";
import type { AssistantJob } from "@/lib/ai/jobs";
import type { AssistantSkill } from "@/lib/ai/skills";
import type { NativeAICapabilities } from "@/lib/ai/native";
import styles from "./AssistantConversation.module.css";

// The transcript inside the assistant sidebar: user and assistant turns,
// lightweight progress rows while the on-device model drives tools, a jobs
// strip so background work stays visible from anywhere, and a skills panel
// (always in the empty state, toggleable above an active thread) where
// craft skills are toggled and new ones installed from skills.sh.
export function AssistantConversation({
  capabilities,
  jobs,
  messages,
  skills,
  submitting,
  onInstallSkill,
  onOpenJob,
  onRemoveSkill,
  onToggleSkill,
}: {
  capabilities: NativeAICapabilities | null;
  jobs?: AssistantJob[];
  messages: AssistantMessage[];
  skills?: Array<AssistantSkill & { enabled: boolean; source?: string }>;
  submitting: boolean;
  onInstallSkill?: (reference: string) => Promise<unknown>;
  onOpenJob?: (job: AssistantJob) => void;
  onRemoveSkill?: (skillId: string) => void;
  onToggleSkill?: (skillId: string, enabled: boolean) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const [installValue, setInstallValue] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [showSkills, setShowSkills] = useState(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, submitting]);

  const install = async () => {
    const reference = installValue.trim();
    if (!reference || !onInstallSkill || installing) return;
    setInstalling(true);
    setInstallError(null);
    try {
      await onInstallSkill(reference);
      setInstallValue("");
    } catch (error) {
      setInstallError(
        error instanceof Error ? error.message : "Could not install",
      );
    } finally {
      setInstalling(false);
    }
  };

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

  const skillsBlock =
    skills && skills.length > 0 ? (
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
            {skill.source && onRemoveSkill && (
              <button
                type="button"
                className={styles.skillRemove}
                aria-label={`Remove skill ${skill.name}`}
                title="Remove skill"
                onClick={(event) => {
                  event.preventDefault();
                  onRemoveSkill(skill.id);
                }}
              >
                Remove
              </button>
            )}
          </label>
        ))}
        {onInstallSkill && (
          <div className={styles.skillInstall}>
            <input
              className={styles.skillInstallInput}
              type="text"
              value={installValue}
              placeholder="Paste a skills.sh link to install"
              disabled={installing}
              onChange={(event) => {
                setInstallValue(event.currentTarget.value);
                setInstallError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void install();
                }
              }}
            />
            <button
              type="button"
              className={styles.skillInstallButton}
              disabled={installing || !installValue.trim()}
              onClick={() => void install()}
            >
              {installing ? "Installing" : "Install"}
            </button>
          </div>
        )}
        {installError && (
          <p className={styles.skillInstallError} role="alert">
            {installError}
          </p>
        )}
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
        {skillsBlock}
      </div>
    );
  }

  return (
    <div className={styles.thread} aria-live="polite">
      {jobsStrip}
      {skillsBlock && (
        <div className={styles.skillsToggleRow}>
          <button
            type="button"
            className={styles.skillsToggle}
            aria-expanded={showSkills}
            onClick={() => setShowSkills((current) => !current)}
          >
            {showSkills ? "Hide skills" : "Skills"}
          </button>
        </div>
      )}
      {showSkills && skillsBlock}
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
