// Fetch a skill definition for the assistant from skills.sh or GitHub.
// The client sends a reference (a skills.sh URL, a GitHub URL, or an
// owner/repo/skill shorthand); the server parses it and fetches SKILL.md
// from raw.githubusercontent.com only, so this can never be used as an
// open proxy. Signed-in users only.

import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type SkillRef = { owner: string; repo: string; skill: string };

const SEGMENT = /^[A-Za-z0-9_.-]+$/;

function parseRef(raw: string): SkillRef | null {
  const value = raw.trim();
  let parts: string[] = [];
  try {
    const url = new URL(value);
    if (
      url.hostname === "skills.sh" ||
      url.hostname === "www.skills.sh" ||
      url.hostname === "github.com" ||
      url.hostname === "www.github.com"
    ) {
      parts = url.pathname.split("/").filter(Boolean);
      // github.com/{owner}/{repo}/tree/{branch}/skills/{skill} form
      const treeIndex = parts.indexOf("tree");
      if (url.hostname.includes("github") && treeIndex !== -1) {
        const owner = parts[0];
        const repo = parts[1];
        const skill = parts[parts.length - 1];
        parts = owner && repo && skill ? [owner, repo, skill] : [];
      }
    } else {
      return null;
    }
  } catch {
    parts = value.split("/").filter(Boolean);
  }
  // skills.sh path may include a literal "skills" segment between repo and
  // skill name; drop it. Two-segment shorthand assumes the repo is "skills".
  if (parts.length === 4 && parts[2] === "skills") {
    parts = [parts[0], parts[1], parts[3]];
  }
  if (parts.length === 2) parts = [parts[0], "skills", parts[1]];
  if (parts.length !== 3) return null;
  const [owner, repo, skill] = parts;
  if (![owner, repo, skill].every((part) => SEGMENT.test(part))) return null;
  return { owner, repo, skill };
}

function frontmatterField(block: string, key: string): string | undefined {
  const match = block.match(new RegExp(`^${key}:\\s*(.+)$`, "mi"));
  return match?.[1]?.trim().replace(/^["']|["']$/g, "");
}

const INSTRUCTION_LIMIT = 1_800;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }
  const ref = parseRef(
    new URL(request.url).searchParams.get("ref") ?? "",
  );
  if (!ref) {
    return Response.json(
      { error: "Use a skills.sh link, a GitHub link, or owner/repo/skill." },
      { status: 400 },
    );
  }

  const candidates = [
    `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/HEAD/skills/${ref.skill}/SKILL.md`,
    `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/HEAD/${ref.skill}/SKILL.md`,
    `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/HEAD/SKILL.md`,
  ];

  for (const url of candidates) {
    const response = await fetch(url, {
      headers: { Accept: "text/plain" },
      cache: "no-store",
    });
    if (!response.ok) continue;
    const text = await response.text();
    if (!text.trim()) continue;

    let name = ref.skill.replace(/-/g, " ");
    let description = "";
    let body = text;
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n?/);
    if (frontmatter) {
      name = frontmatterField(frontmatter[1], "name") ?? name;
      description = frontmatterField(frontmatter[1], "description") ?? "";
      body = text.slice(frontmatter[0].length);
    }
    const trimmedBody = body.trim();
    const truncated = trimmedBody.length > INSTRUCTION_LIMIT;
    return Response.json({
      id: `${ref.owner}/${ref.repo}/${ref.skill}`,
      name,
      description,
      instructions: truncated
        ? `${trimmedBody.slice(0, INSTRUCTION_LIMIT)}\n\n(Skill trimmed to fit the assistant context.)`
        : trimmedBody,
      source: `https://www.skills.sh/${ref.owner}/${ref.repo}/${ref.skill}`,
      truncated,
    });
  }

  return Response.json(
    { error: "No SKILL.md found for that reference." },
    { status: 404 },
  );
}
