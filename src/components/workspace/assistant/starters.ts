// What the assistant says before anybody has said anything to it.
//
// The empty rail used to lead with plumbing ("Using Anthropic", or how to add
// an API key). That tells a person what the software is wired to, not what it
// can do for the thing they are looking at, so there was no reason to start.
//
// A greeting and three starters that name the current document give the rail a
// reason to be open. The starters are deliberately not free text: each one maps
// to work the assistant can actually do here, so the first thing anybody tries
// is a thing that works.

export type StarterContextLevel = "item" | "folder" | "trash" | "shared" | "root";

export type StarterContext = {
  level: StarterContextLevel;
  /** The item title or folder name, when there is one. */
  label?: string | null;
  templateId?: string | null;
};

/**
 * The rail already resolves a context chip for the composer; this reuses it
 * rather than resolving the view a second time and risking the two disagreeing
 * about where the person is.
 */
export function starterContextFromChip(chip: {
  kind?: "workspace" | "folder" | "item";
  label?: string;
  templateId?: string;
}): StarterContext {
  const label = chip.label ?? null;
  switch (chip.kind) {
    case "item":
      return { level: "item", label, templateId: chip.templateId };
    case "folder":
      // Trash and Shared with me arrive as folders but read as places, and
      // asking to "sharpen your writing" in Trash is nonsense.
      if (label === "Trash") return { level: "trash" };
      if (label === "Shared with me") return { level: "shared" };
      return { level: "folder", label };
    default:
      return { level: "root", label };
  }
}

export type Starter = {
  label: string;
  prompt: string;
};

export function workflowHeading(context: StarterContext): string {
  if (context.level === "item" || context.level === "folder") {
    return `Ways to work with ${context.label}`;
  }
  return "Start with a workspace workflow";
}

/**
 * Time of day in the reader's own clock. Split out so the boundaries are
 * testable without waiting for the afternoon.
 */
export function greetingPhrase(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "Good afternoon, Ramine", or just the phrase when we have no name. */
export function greeting(name: string | null | undefined, at: Date): string {
  const phrase = greetingPhrase(at.getHours());
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first ? `${phrase}, ${first}` : phrase;
}

/**
 * Kept short so a starter reads as one line in a narrow rail. 48 rather than
 * something tighter because a real title ("The Invisible Hand of Super
 * Metroid") is 34 characters, and clipping that mid-word makes the assistant
 * look like it cannot read.
 */
function clip(value: string, max = 48): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Three starters for where the person actually is. Naming the document is the
 * point: "Summarize this page" reads like a demo, "Sharpen my writing on Super
 * Metroid" reads like the assistant already knows what you are doing.
 */
export function startersFor(context: StarterContext): Starter[] {
  const named = context.label ? clip(context.label) : null;

  switch (context.level) {
    case "item":
      if (context.templateId === "texttext.brief") {
        return [
          {
            label: "Check what changed in my sources",
            prompt:
              "Review this Living brief's sources. Name the sources that changed or disappeared, identify the exact claims affected, and do not revise anything yet.",
          },
          {
            label: "Refresh affected claims",
            prompt:
              "Review this Living brief's sources, reread only the sources that changed, and update only the affected claims and evidence. Keep unrelated claims stable.",
          },
          {
            label: "Create a publication draft",
            prompt:
              "Create a new publication draft from this Living brief. Use only supported claims, obey the enabled publication writing rules, keep source references visible, and do not publish it.",
          },
        ];
      }
      return [
        {
          label: named ? `Sharpen my writing on ${named}` : "Sharpen my writing here",
          prompt: "Tighten the writing on this item without changing what it says.",
        },
        {
          label: "Challenge my thinking on this page",
          prompt:
            "Read this item and push back on it: what is unsupported, missing, or contradicts itself?",
        },
        { label: "Find related work", prompt: "Find items in this workspace related to this one." },
      ];
    case "folder":
      return [
        {
          label: named ? `What is in ${named}?` : "What is in this collection?",
          prompt: "Summarize what this collection contains and how it is organized.",
        },
        {
          label: "Find gaps and duplicates",
          prompt:
            "Look across this collection for items that overlap, contradict each other, or are missing an obvious companion.",
        },
        {
          label: "Create a sourced brief",
          prompt:
            "Read the useful items in this collection and create a Living brief here with a visible source ledger and evidence-backed claims.",
        },
      ];
    case "trash":
      return [
        { label: "What did I delete?", prompt: "Summarize what is in Trash and when it was deleted." },
        {
          label: "Anything worth keeping?",
          prompt: "Look through Trash for anything that looks worth restoring, and say why.",
        },
        {
          label: "Empty Trash",
          prompt: "Show me exactly what is in Trash, then offer to empty it permanently for my approval.",
        },
      ];
    case "shared":
      return [
        { label: "Catch me up", prompt: "Summarize what has changed recently in items shared with me." },
        { label: "What needs a reply?", prompt: "Find shared items that look like they are waiting on me." },
      ];
    case "root":
    default:
      return [
        {
          label: "Turn recent notes into a sourced brief",
          prompt:
            "Read my recent notes and create one clear brief with a visible source ledger linking every item you used.",
        },
        {
          label: "Build a project tracker",
          prompt: "Build a reusable project tracker item type with status, owner, priority, due date, and a folder view grouped by status. Show me the structure before applying it.",
        },
        {
          label: "Organize my recent notes",
          prompt: "Review my recent notes, identify a useful organization, and propose the exact tags or folder moves before changing anything.",
        },
      ];
  }
}
