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
};

export type Starter = {
  label: string;
  prompt: string;
};

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

/** "Good afternoon, Ramine" — or just the phrase when we have no name. */
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
        { label: "Draft something new here", prompt: "Suggest three items worth writing in this collection." },
      ];
    case "trash":
      return [
        { label: "What did I delete?", prompt: "Summarize what is in Trash and when it was deleted." },
        {
          label: "Anything worth keeping?",
          prompt: "Look through Trash for anything that looks worth restoring, and say why.",
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
        { label: "Catch me up", prompt: "Summarize what I have been working on recently." },
        {
          label: "Find something I started",
          prompt: "Find items that look unfinished or abandoned, and say what each one needs.",
        },
        { label: "Start something new", prompt: "Suggest three things worth writing about, based on my recent work." },
      ];
  }
}
