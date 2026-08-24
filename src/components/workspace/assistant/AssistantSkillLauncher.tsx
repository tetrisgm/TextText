"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type RefObject,
} from "react";
import { getWorkspaceAgentSkillMetadataAction } from "@/app/editor/agent-skill-metadata-actions";
import {
  insertAssistantSkillTrigger,
  matchingAssistantSkills,
  skillLauncherKeyAction,
  type AssistantSkillMetadata,
} from "./skill-launcher";
import styles from "./AssistantSkillLauncher.module.css";

type AssistantSkillLauncherProps = {
  composerRef: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
  onChange: (value: string) => void;
  skills: readonly AssistantSkillMetadata[];
  value: string;
};

export function AssistantSkillLauncher({
  composerRef,
  disabled = false,
  onChange,
  skills,
  value,
}: AssistantSkillLauncherProps) {
  const generatedId = useId();
  const listboxId = `assistant-skills-${generatedId}`;
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedValue, setDismissedValue] = useState<string | null>(null);
  const matches = useMemo(
    () => matchingAssistantSkills(skills, value),
    [skills, value],
  );
  const open = !disabled && matches.length > 0 && dismissedValue !== value;
  const resolvedActiveIndex = Math.min(activeIndex, matches.length - 1);

  const selectSkill = useCallback(
    (skill: AssistantSkillMetadata) => {
      const nextValue = insertAssistantSkillTrigger(skill.trigger);
      onChange(nextValue);
      requestAnimationFrame(() => {
        const composer = composerRef.current;
        if (!composer) return;
        composer.focus();
        composer.setSelectionRange(nextValue.length, nextValue.length);
      });
    },
    [composerRef, onChange],
  );

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;

    if (open) {
      composer.setAttribute("aria-autocomplete", "list");
      composer.setAttribute("aria-controls", listboxId);
      composer.setAttribute("aria-expanded", "true");
      composer.setAttribute(
        "aria-activedescendant",
        `${listboxId}-option-${resolvedActiveIndex}`,
      );
    } else {
      composer.removeAttribute("aria-autocomplete");
      composer.removeAttribute("aria-controls");
      composer.removeAttribute("aria-activedescendant");
      composer.setAttribute("aria-expanded", "false");
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!open || event.isComposing) return;
      const action = skillLauncherKeyAction({
        activeIndex: resolvedActiveIndex,
        count: matches.length,
        key: event.key,
      });
      if (action.kind === "none") return;
      event.preventDefault();
      event.stopPropagation();
      if (action.kind === "move") {
        setActiveIndex(action.index);
      } else if (action.kind === "select") {
        const selected = matches[action.index];
        if (selected) selectSkill(selected);
      } else {
        setDismissedValue(value);
      }
    };
    const onInput = () => setDismissedValue(null);
    composer.addEventListener("keydown", onKeyDown);
    composer.addEventListener("input", onInput);
    return () => {
      composer.removeEventListener("keydown", onKeyDown);
      composer.removeEventListener("input", onInput);
      composer.removeAttribute("aria-autocomplete");
      composer.removeAttribute("aria-controls");
      composer.removeAttribute("aria-activedescendant");
      composer.removeAttribute("aria-expanded");
    };
  }, [
    composerRef,
    listboxId,
    matches,
    open,
    resolvedActiveIndex,
    selectSkill,
    value,
  ]);

  if (!open) return null;
  return (
    <div
      className={styles.launcher}
      id={listboxId}
      role="listbox"
      aria-label="Reusable skills"
    >
      {matches.map((skill, index) => (
        <button
          className={styles.option}
          id={`${listboxId}-option-${index}`}
          key={skill.trigger}
          type="button"
          role="option"
          aria-selected={index === resolvedActiveIndex}
          data-active={index === resolvedActiveIndex ? "true" : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => selectSkill(skill)}
        >
          <span className={styles.name}>{skill.name}</span>
          <span className={styles.trigger}>/{skill.trigger}</span>
        </button>
      ))}
    </div>
  );
}

type WorkspaceAssistantSkillLauncherProps = Omit<
  AssistantSkillLauncherProps,
  "skills"
> & {
  handle: string;
};

export function WorkspaceAssistantSkillLauncher({
  handle,
  ...launcherProps
}: WorkspaceAssistantSkillLauncherProps) {
  const [skills, setSkills] = useState<AssistantSkillMetadata[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getWorkspaceAgentSkillMetadataAction(handle).then((state) => {
      if (!cancelled) setSkills(state.allowed ? state.skills : []);
    });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  return <AssistantSkillLauncher {...launcherProps} skills={skills} />;
}
