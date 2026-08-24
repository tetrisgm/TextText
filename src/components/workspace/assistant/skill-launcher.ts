import {
  MAX_WORKSPACE_AGENT_SKILLS,
  MAX_WORKSPACE_AGENT_SKILL_NAME,
  MAX_WORKSPACE_AGENT_SKILL_TRIGGER,
} from "@/lib/ai/agent-instructions";

export const MAX_SKILL_LAUNCHER_RESULTS = 8;

export type AssistantSkillMetadata = {
  name: string;
  trigger: string;
};

/**
 * Reduce saved settings to the only fields the chat launcher may receive.
 * Instructions deliberately cannot survive this boundary.
 */
export function boundedAssistantSkillMetadata(
  input: unknown,
): AssistantSkillMetadata[] {
  if (!Array.isArray(input)) return [];
  const triggers = new Set<string>();
  const skills: AssistantSkillMetadata[] = [];
  for (const entry of input.slice(0, MAX_WORKSPACE_AGENT_SKILLS)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const name =
      typeof record.name === "string"
        ? record.name.trim().replace(/\s+/g, " ")
        : "";
    const trigger =
      typeof record.trigger === "string"
        ? record.trigger.trim().toLowerCase()
        : "";
    if (
      !name ||
      name.length > MAX_WORKSPACE_AGENT_SKILL_NAME ||
      trigger.length > MAX_WORKSPACE_AGENT_SKILL_TRIGGER ||
      !/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(trigger) ||
      triggers.has(trigger)
    ) {
      continue;
    }
    triggers.add(trigger);
    skills.push({ name, trigger });
  }
  return skills;
}

export function assistantSkillQuery(value: string): string | null {
  const match = value.match(/^\/([a-z0-9-]*)$/i);
  return match ? match[1].toLowerCase() : null;
}

export function matchingAssistantSkills(
  skills: readonly AssistantSkillMetadata[],
  value: string,
): AssistantSkillMetadata[] {
  const query = assistantSkillQuery(value);
  if (query === null) return [];
  return skills
    .filter(
      (skill) =>
        skill.trigger.includes(query) || skill.name.toLowerCase().includes(query),
    )
    .slice(0, MAX_SKILL_LAUNCHER_RESULTS);
}

export function insertAssistantSkillTrigger(trigger: string): string {
  return `/${trigger} `;
}

export type SkillLauncherKeyAction =
  | { kind: "dismiss" }
  | { kind: "move"; index: number }
  | { kind: "none" }
  | { kind: "select"; index: number };

export function skillLauncherKeyAction({
  activeIndex,
  count,
  key,
}: {
  activeIndex: number;
  count: number;
  key: string;
}): SkillLauncherKeyAction {
  if (count <= 0) return { kind: "none" };
  const current = Math.min(Math.max(activeIndex, 0), count - 1);
  if (key === "ArrowDown") {
    return { kind: "move", index: (current + 1) % count };
  }
  if (key === "ArrowUp") {
    return { kind: "move", index: (current - 1 + count) % count };
  }
  if (key === "Home") return { kind: "move", index: 0 };
  if (key === "End") return { kind: "move", index: count - 1 };
  if (key === "Enter" || key === "Tab") {
    return { kind: "select", index: current };
  }
  if (key === "Escape") return { kind: "dismiss" };
  return { kind: "none" };
}
