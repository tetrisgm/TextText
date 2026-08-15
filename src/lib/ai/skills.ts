"use client";

// Skills: short, composable instruction files for the writing assistant,
// modeled on agent skill files. Each skill teaches the model one craft
// (what a blog post is, how notes read, how titles work). Skills are
// toggleable per workspace and selected per request by trigger keywords or
// the current context, then composed with the base instructions and sent
// with the agent request.
//
// Keep the base under ~150 words, each skill under ~180, and at most two
// skills per request so constrained providers can still act reliably.
//
// Roadmap (owner-approved direction): skills as markdown items in the
// workspace itself, so they sync, are editable in-app like any note, and
// can be installed or shared; a settings page manages them. This module is
// the engine that stays; the catalog becomes data.

export type AssistantSkill = {
  id: string;
  name: string;
  description: string;
  /** Lowercase keywords that select this skill from the prompt. */
  triggers: string[];
  /** Substrings of the context description that select this skill. */
  contextTriggers: string[];
  instructions: string;
};

export const BASE_ASSISTANT_INSTRUCTIONS = `You are the assistant inside TextText, an app for blogs, notes, and bookmarks. The Blog folder holds real blog posts for readers; Notes are private working notes; Bookmarks are saved links.

Perform the user's request with the tools, acting on their workspace directly. Prefer acting over asking: when a reasonable interpretation exists, proceed with it instead of asking a question. Only list or read existing items when the request is about existing items.

When an item is open, "this", "it", "the title", "rewrite", and "add a section" refer to that active item. Read it when needed, then use update_item or append_to_item. Do not call create_item for a request about the active item.

For a blog post or other public writing, call create_item with kind article in the Blog folder. When the user does not name a destination, use the Blog folder for public writing.

Every create_item call must include a non-empty title. When you wrote content for the item, include the complete body too. Never call create_item with an empty object.

You CAN delete a whole item with delete_item. To remove or change PART of an item's content (some jokes from a list, a paragraph, a section), use read_item, then update_item with the revised full body.

When asked to write something, the item body must be the complete finished piece in markdown. Never put a one-line answer where the piece should be, never add meta commentary, and never mention being an AI.

Handle every item the user names: each named item gets its own tool call, and you are not done until all of them are handled. Never delete or publish unless the user explicitly asked. When everything is done, reply with one short sentence about what you did.`;

export const BUILTIN_SKILLS: AssistantSkill[] = [
  {
    id: "blog-post",
    name: "Blog posts",
    description: "Structure and voice for real, readable blog posts.",
    triggers: ["blog", "post", "article", "publish"],
    contextTriggers: ["blog", "post", "article"],
    instructions: `Writing a blog post: it is a complete article a stranger would enjoy reading, never a bare answer. Open with a hook sentence that frames why the topic matters. Develop the idea in 3 to 5 short sections; use ## markdown headings when the piece runs long. Take a clear position and support it with specifics (examples, details, comparisons). Close with a takeaway. Aim for 300 to 600 words unless the user asks for a length. Give it a specific sentence-case title under nine words.`,
  },
  {
    id: "notes",
    name: "Notes",
    description: "Concise capture style for private notes.",
    triggers: ["note", "notes", "remember", "capture", "meeting", "idea"],
    contextTriggers: ["notes folder", "note"],
    instructions: `Writing a note: notes are private working material, so favor density over polish. Lead with the core fact or decision on the first line. Use short markdown bullets for details, next steps, and open questions. Keep the user's own wording where it carries meaning. No filler, no introductions, no conclusions.`,
  },
  {
    id: "titles",
    name: "Titles and excerpts",
    description: "Sharper titles and excerpts for existing items.",
    triggers: ["title", "headline", "excerpt", "rename", "summary line"],
    contextTriggers: [],
    instructions: `Crafting titles: specific beats clever; name the actual subject, sentence case, no quotes, under nine words. Crafting excerpts: one or two sentences, at most 240 characters, that make someone want to read the piece; plain prose, no hashtags, never a repeat of the title.`,
  },
];

const DISABLED_KEY_PREFIX = "texttext:ai-skills-disabled:";
const CUSTOM_KEY_PREFIX = "texttext:ai-skills-custom:";

function disabledSet(handle: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(`${DISABLED_KEY_PREFIX}${handle}`);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export type CustomSkill = AssistantSkill & { source: string };

function customSkills(handle: string): CustomSkill[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${CUSTOM_KEY_PREFIX}${handle}`);
    return raw ? (JSON.parse(raw) as CustomSkill[]) : [];
  } catch {
    return [];
  }
}

function saveCustomSkills(handle: string, skills: CustomSkill[]) {
  try {
    localStorage.setItem(`${CUSTOM_KEY_PREFIX}${handle}`, JSON.stringify(skills));
  } catch {
    // Best effort.
  }
}

/**
 * Install a skill from skills.sh or GitHub by URL or owner/repo/skill
 * reference. The server route fetches SKILL.md (GitHub raw only) and trims
 * it for a constrained provider context budget. Installed skill text becomes part of
 * the model's instructions, so installing is an act of trust, like
 * installing any agent skill; the confirm lives in the UI.
 */
export async function installSkill(
  handle: string,
  reference: string,
): Promise<CustomSkill> {
  const response = await fetch(
    `/api/ai/skills/fetch?ref=${encodeURIComponent(reference)}`,
    { credentials: "same-origin" },
  );
  const payload = (await response.json()) as
    | { error: string }
    | {
        id: string;
        name: string;
        description: string;
        instructions: string;
        source: string;
      };
  if ("error" in payload) throw new Error(payload.error);
  const triggers = [
    ...new Set(
      `${payload.name} ${payload.id.split("/").pop() ?? ""}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 3),
    ),
  ];
  const skill: CustomSkill = {
    id: `custom:${payload.id}`,
    name: payload.name,
    description: payload.description || "Installed skill",
    triggers,
    contextTriggers: [],
    instructions: payload.instructions,
    source: payload.source,
  };
  const existing = customSkills(handle).filter(
    (candidate) => candidate.id !== skill.id,
  );
  saveCustomSkills(handle, [...existing, skill]);
  return skill;
}

export function removeSkill(handle: string, skillId: string) {
  saveCustomSkills(
    handle,
    customSkills(handle).filter((skill) => skill.id !== skillId),
  );
}

export function skillStates(
  handle: string,
): Array<AssistantSkill & { enabled: boolean; source?: string }> {
  const disabled = disabledSet(handle);
  return [...BUILTIN_SKILLS, ...customSkills(handle)].map((skill) => ({
    ...skill,
    enabled: !disabled.has(skill.id),
  }));
}

export function setSkillEnabled(
  handle: string,
  skillId: string,
  enabled: boolean,
) {
  const disabled = disabledSet(handle);
  if (enabled) disabled.delete(skillId);
  else disabled.add(skillId);
  try {
    localStorage.setItem(
      `${DISABLED_KEY_PREFIX}${handle}`,
      JSON.stringify([...disabled]),
    );
  } catch {
    // Best effort; in-memory defaults still apply next session.
  }
}
