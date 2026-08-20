import { generateText } from "ai";
import { getCurrentUser } from "@/lib/session";
import { getOwnedBlog } from "@/lib/store";
import { workspaceLanguageModel } from "@/lib/ai/provider-model.server";
import { getWorkspaceAiConfigForOwner } from "@/lib/ai/workspace-ai-config.server";
import {
  compileItemTypeBlueprint,
  itemTypeBlueprintSchema,
  type ItemTypeBlueprint,
} from "@/lib/presentation/item-type-blueprint";
import {
  ITEM_TYPE_BLUEPRINT_FORMAT,
  honorNamedStyleReference,
  itemTypeBlueprintRepairPrompt,
  parseItemTypeBlueprintText,
} from "@/lib/ai/item-type-generation";
import {
  assessItemTypeQuality,
  itemTypeQualityRevisionPrompt,
} from "@/lib/presentation/item-type-quality";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import { readBoundedJson } from "@/lib/http/bounded-json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PROMPT_CHARS = 6_000;
const MAX_REQUEST_BODY_BYTES = 1_100_000;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;
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
- A calendar or heatmap must have a date dateBy field.
- Keep summaryFields to the two or three values people need while scanning the folder.
- Use rows only when one item genuinely contains a repeated list, such as checklist steps or recipe ingredients.
- Use reference for relations between items, people for links to people records, and recurrence for repeating schedules.
- Use a status enum workflow only when allowed transitions make the process clearer.
- Use computed fields for read-only row rollups or numeric progress. Never ask the writer to enter a computed value.
- Add named collection views when the request implies distinct useful perspectives, such as My tasks, Due soon, Board, or Calendar. Each view may have its own filters, grouping, and sort.
- Use showWhen for low-frequency detail that should appear only after a boolean or enum choice is set. Keep validation constraints practical.
- Choose publishable only when the request is clearly for public reading.
- Product copy uses sentence case and never uses an em dash.
- The result must feel ready to use, not like a schema exercise.

${ITEM_TYPE_BLUEPRINT_FORMAT}`;

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

  const decoded = await readBoundedJson<{
    prompt?: unknown;
    current?: unknown;
    folderName?: unknown;
  }>(request, MAX_REQUEST_BODY_BYTES);
  if ("error" in decoded && decoded.error === "too_large") {
    return Response.json(
      { error: "The design request is too large." },
      { status: 413, headers: NO_STORE_HEADERS },
    );
  }
  if ("error" in decoded) {
    return Response.json(
      { error: "Send a JSON body." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const body = decoded.value;
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
    const model = workspaceLanguageModel(config);
    const result = await generateText({
      model,
      system: SYSTEM,
      prompt: designPrompt,
    });
    let blueprint: ItemTypeBlueprint;
    let template: TemplateDefinition;
    try {
      blueprint = honorNamedStyleReference(
        parseItemTypeBlueprintText(result.text),
        prompt,
      );
      template = compileItemTypeBlueprint(blueprint, {
        id: "preview.item-type",
      });
    } catch (validationError) {
      const repaired = await generateText({
        model,
        system: SYSTEM,
        prompt: itemTypeBlueprintRepairPrompt({
          error: validationError,
          generated: result.text,
          request: designPrompt,
        }),
      });
      blueprint = honorNamedStyleReference(
        parseItemTypeBlueprintText(repaired.text),
        prompt,
      );
      template = compileItemTypeBlueprint(blueprint, {
        id: "preview.item-type",
      });
    }
    // Schema validity is the safety floor, not the design bar. Give the model
    // one focused revision when a valid blueprint would still produce an
    // empty page, an ungrouped board, or another visibly incomplete result.
    // Keep the original when the revision does not measurably improve it.
    const firstReview = assessItemTypeQuality(blueprint);
    if (!firstReview.passes) {
      try {
        const revised = await generateText({
          model,
          system: SYSTEM,
          prompt: itemTypeQualityRevisionPrompt(blueprint, firstReview),
        });
        const candidate = honorNamedStyleReference(
          parseItemTypeBlueprintText(revised.text),
          prompt,
        );
        const candidateTemplate = compileItemTypeBlueprint(candidate, {
          id: "preview.item-type",
        });
        const candidateReview = assessItemTypeQuality(candidate);
        if (candidateReview.score > firstReview.score) {
          blueprint = candidate;
          template = candidateTemplate;
        }
      } catch {
        // The first result is already schema-valid and safe to preview. A
        // failed optional polish pass must not discard it or turn the whole
        // request into a provider error. The studio's deterministic preflight
        // still explains anything the writer should refine before saving.
      }
    }
    return Response.json({ blueprint, template });
  } catch (error) {
    const failure =
      error && typeof error === "object"
        ? {
            name:
              "name" in error && typeof error.name === "string"
                ? error.name
                : "Error",
            statusCode:
              "statusCode" in error && typeof error.statusCode === "number"
                ? error.statusCode
                : null,
            providerError:
              "responseBody" in error && typeof error.responseBody === "string"
                ? error.responseBody
                    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
                    .slice(0, 1_000)
                : null,
          }
        : { name: "Error", statusCode: null, providerError: null };
    console.error("item type generation failed", failure);
    return Response.json(
      { error: "The assistant could not finish that design. Try a shorter description." },
      { status: 502 },
    );
  }
}
