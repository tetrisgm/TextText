import { generateObject } from "ai";
import { getCurrentUser } from "@/lib/session";
import { getOwnedBlog } from "@/lib/store";
import { workspaceLanguageModel } from "@/lib/ai/provider-model.server";
import { getWorkspaceAiConfigForOwner } from "@/lib/ai/workspace-ai-config.server";
import {
  compileItemTypeBlueprint,
  itemTypeBlueprintSchema,
  type ItemTypeBlueprint,
} from "@/lib/presentation/item-type-blueprint";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PROMPT_CHARS = 6_000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 12;
const recentHits = new Map<string, number[]>();

function rateLimited(subject: string): boolean {
  const now = Date.now();
  const recent = (recentHits.get(subject) ?? []).filter(
    (at) => now - at < RATE_WINDOW_MS,
  );
  recent.push(now);
  recentHits.set(subject, recent);
  return recent.length > RATE_MAX_PER_WINDOW;
}

function cleanPrompt(value: unknown): string {
  return typeof value === "string"
    ? value.trim().slice(0, MAX_PROMPT_CHARS)
    : "";
}

const SYSTEM = `You design reusable item types for a calm writing workspace.

Return one complete item type blueprint. It controls both the item page and the folder page that lists those items.

Rules:
- Infer a small, useful property set. Prefer 3 to 7 fields. Do not add fields just because you can.
- Use styleReference when the writer names a familiar product or publication, such as Medium, Notion, or Apple Notes. Capture the visual principles, never trademarks or copied assets.
- A board must have a single-select enum groupBy field.
- A calendar must have a date dateBy field.
- Keep summaryFields to the two or three values people need while scanning the folder.
- Use rows only when one item genuinely contains a repeated list, such as checklist steps or recipe ingredients.
- Choose publishable only when the request is clearly for public reading.
- Product copy uses sentence case and never uses an em dash.
- The result must feel ready to use, not like a schema exercise.`;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Sign in to build an item type." }, { status: 401 });
  }
  const workspace = await getOwnedBlog(user.sub);
  if (!workspace) {
    return Response.json({ error: "You do not have a workspace." }, { status: 403 });
  }
  const config = await getWorkspaceAiConfigForOwner(user.sub);
  if (!config) {
    return Response.json(
      { error: "Connect an AI provider before building with AI." },
      { status: 404 },
    );
  }
  if (rateLimited(user.sub)) {
    return Response.json(
      { error: "Too many design requests. Try again in a moment." },
      { status: 429 },
    );
  }

  let body: { prompt?: unknown; current?: unknown; folderName?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const prompt = cleanPrompt(body.prompt);
  if (!prompt) {
    return Response.json({ error: "Describe what you want to build." }, { status: 400 });
  }
  const current = body.current
    ? itemTypeBlueprintSchema.safeParse(body.current)
    : null;
  const folderName = cleanPrompt(body.folderName).slice(0, 160);
  const designPrompt = [
    folderName ? `Destination folder: ${folderName}` : null,
    current?.success
      ? `Current design to revise:\n${JSON.stringify(current.data)}`
      : null,
    `Writer request:\n${prompt}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const result = await generateObject({
      model: workspaceLanguageModel(config),
      schema: itemTypeBlueprintSchema,
      schemaName: "TextTextItemType",
      schemaDescription:
        "A complete reusable item type with item-page and collection-page behavior.",
      system: SYSTEM,
      prompt: designPrompt,
    });
    const blueprint: ItemTypeBlueprint = itemTypeBlueprintSchema.parse(
      result.object,
    );
    const template = compileItemTypeBlueprint(blueprint, {
      id: "preview.item-type",
    });
    return Response.json({ blueprint, template });
  } catch {
    console.error("item type generation failed");
    return Response.json(
      { error: "The assistant could not finish that design. Try a shorter description." },
      { status: 502 },
    );
  }
}
