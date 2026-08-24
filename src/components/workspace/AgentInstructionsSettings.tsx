"use client";

import { useEffect, useState } from "react";
import {
  getWorkspaceAgentSettingsAction,
  removeWorkspaceAgentSettingsAction,
  saveWorkspaceAgentSettingsAction,
} from "@/app/editor/agent-instructions-actions";
import {
  MAX_WORKSPACE_AGENT_INSTRUCTIONS,
  MAX_WORKSPACE_AGENT_SKILLS,
  MAX_WORKSPACE_AGENT_SKILL_INSTRUCTIONS,
  MAX_WORKSPACE_AGENT_SKILL_NAME,
  MAX_WORKSPACE_AGENT_SKILL_TRIGGER,
  type WorkspaceAgentSkill,
} from "@/lib/ai/agent-instructions";
import styles from "./AgentInstructionsSettings.module.css";

type DraftSkill = WorkspaceAgentSkill & { key: string };

function draftSkills(skills: readonly WorkspaceAgentSkill[]): DraftSkill[] {
  return skills.map((skill, index) => ({
    ...skill,
    key: `${skill.trigger}:${index}`,
  }));
}

function availableTrigger(skills: readonly DraftSkill[]): string {
  const used = new Set(skills.map((skill) => skill.trigger));
  if (!used.has("new-skill")) return "new-skill";
  for (let number = 2; number <= MAX_WORKSPACE_AGENT_SKILLS; number += 1) {
    if (!used.has(`new-skill-${number}`)) return `new-skill-${number}`;
  }
  return "skill";
}

export function AgentInstructionsSettings({ handle }: { handle: string }) {
  const [allowed, setAllowed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [skills, setSkills] = useState<DraftSkill[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getWorkspaceAgentSettingsAction(handle).then((next) => {
      if (cancelled) return;
      setAllowed(next.allowed);
      setInstructions(next.instructions);
      setSkills(draftSkills(next.skills));
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  if (!loaded) {
    return <p className={styles.status}>Loading agent instructions.</p>;
  }
  if (!allowed) return null;

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const next = await saveWorkspaceAgentSettingsAction(handle, {
        instructions,
        skills: skills.map(
          ({ name, trigger, instructions: skillInstructions }) => ({
            name,
            trigger,
            instructions: skillInstructions,
          }),
        ),
      });
      setInstructions(next.instructions);
      setSkills(draftSkills(next.skills));
      setSaved(true);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save agent instructions.",
      );
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const next = await removeWorkspaceAgentSettingsAction(handle);
      setInstructions(next.instructions);
      setSkills([]);
      setSaved(true);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not clear agent instructions.",
      );
    } finally {
      setSaving(false);
    }
  };

  const hasContent = Boolean(instructions.trim() || skills.length);

  return (
    <div className={styles.block} id="settings-agent-instructions">
      <div className={styles.heading}>
        <div>
          <h3>Agent instructions</h3>
          <p>
            Set durable guidance for this workspace. Only text saved here is
            trusted as instruction. Notes, search results, and retrieved text
            remain reference material.
          </p>
        </div>
      </div>

      <label className={styles.field}>
        <span>Standing instructions</span>
        <textarea
          value={instructions}
          maxLength={MAX_WORKSPACE_AGENT_INSTRUCTIONS}
          rows={5}
          placeholder="For example: Keep answers concise and preserve my terminology."
          onChange={(event) => {
            setInstructions(event.currentTarget.value);
            setSaved(false);
          }}
        />
        <small>
          {instructions.length.toLocaleString()} of{" "}
          {MAX_WORKSPACE_AGENT_INSTRUCTIONS.toLocaleString()}
        </small>
      </label>

      <div className={styles.skillsHeader}>
        <div>
          <h4>Reusable skills</h4>
          <p>
            A skill runs only when your request includes its shortcut, such as
            /weekly-review.
          </p>
        </div>
        <button
          type="button"
          className="ac-btn ac-btn-gray"
          disabled={skills.length >= MAX_WORKSPACE_AGENT_SKILLS}
          onClick={() => {
            const trigger = availableTrigger(skills);
            setSkills((previous) => [
              ...previous,
              {
                key: `${trigger}:${Date.now()}`,
                name: "",
                trigger,
                instructions: "",
              },
            ]);
            setSaved(false);
          }}
        >
          Add skill
        </button>
      </div>

      {skills.length > 0 ? (
        <div className={styles.skillList}>
          {skills.map((skill, index) => (
            <fieldset className={styles.skill} key={skill.key}>
              <legend>Skill {index + 1}</legend>
              <div className={styles.skillTopRow}>
                <label className={styles.field}>
                  <span>Name</span>
                  <input
                    value={skill.name}
                    maxLength={MAX_WORKSPACE_AGENT_SKILL_NAME}
                    placeholder="Weekly review"
                    onChange={(event) => {
                      const name = event.currentTarget.value;
                      setSkills((previous) =>
                        previous.map((entry) =>
                          entry.key === skill.key ? { ...entry, name } : entry,
                        ),
                      );
                      setSaved(false);
                    }}
                  />
                </label>
                <label className={styles.field}>
                  <span>Shortcut</span>
                  <div className={styles.triggerField}>
                    <span aria-hidden="true">/</span>
                    <input
                      value={skill.trigger}
                      maxLength={MAX_WORKSPACE_AGENT_SKILL_TRIGGER}
                      spellCheck={false}
                      onChange={(event) => {
                        const trigger = event.currentTarget.value
                          .toLowerCase()
                          .replace(/[^a-z0-9-]/g, "");
                        setSkills((previous) =>
                          previous.map((entry) =>
                            entry.key === skill.key
                              ? { ...entry, trigger }
                              : entry,
                          ),
                        );
                        setSaved(false);
                      }}
                    />
                  </div>
                </label>
                <button
                  type="button"
                  className="ac-btn ac-btn-plain"
                  onClick={() => {
                    setSkills((previous) =>
                      previous.filter((entry) => entry.key !== skill.key),
                    );
                    setSaved(false);
                  }}
                >
                  Remove
                </button>
              </div>
              <label className={styles.field}>
                <span>Instructions</span>
                <textarea
                  value={skill.instructions}
                  maxLength={MAX_WORKSPACE_AGENT_SKILL_INSTRUCTIONS}
                  rows={4}
                  placeholder="Describe the steps, voice, and expected result."
                  onChange={(event) => {
                    const skillInstructions = event.currentTarget.value;
                    setSkills((previous) =>
                      previous.map((entry) =>
                        entry.key === skill.key
                          ? { ...entry, instructions: skillInstructions }
                          : entry,
                      ),
                    );
                    setSaved(false);
                  }}
                />
              </label>
            </fieldset>
          ))}
        </div>
      ) : (
        <p className={styles.status}>No reusable skills yet.</p>
      )}

      <div className={styles.actions}>
        {hasContent && (
          <button
            type="button"
            className="ac-btn ac-btn-plain"
            disabled={saving}
            onClick={() => void clear()}
          >
            Clear all
          </button>
        )}
        <button
          type="button"
          className="ac-btn ac-btn-filled"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Saving" : "Save instructions"}
        </button>
      </div>
      {saved && (
        <p className={styles.saved} role="status">
          Saved.
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
