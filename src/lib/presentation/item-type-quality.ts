import type {
  ItemTypeBlueprint,
  ItemTypeFieldBlueprint,
} from "@/lib/presentation/item-type-blueprint";

export type ItemTypeQualityFinding = {
  code: string;
  message: string;
  severity: "important" | "suggestion";
};

export type ItemTypeQualityReport = {
  findings: ItemTypeQualityFinding[];
  passes: boolean;
  score: number;
};

function scalarFields(blueprint: ItemTypeBlueprint) {
  return blueprint.fields.filter(
    (field): field is Exclude<ItemTypeFieldBlueprint, { type: "rows" }> =>
      field.type !== "rows",
  );
}

function finding(
  code: string,
  message: string,
  severity: ItemTypeQualityFinding["severity"],
): ItemTypeQualityFinding {
  return { code, message, severity };
}

/**
 * A deterministic preflight for generated item types. It deliberately checks
 * product quality rather than schema validity: the schema answers whether a
 * design is safe to render, while this answers whether it is useful enough to
 * show a writer.
 */
export function assessItemTypeQuality(
  blueprint: ItemTypeBlueprint,
): ItemTypeQualityReport {
  const findings: ItemTypeQualityFinding[] = [];
  const fields = scalarFields(blueprint);
  const fieldById = new Map(blueprint.fields.map((field) => [field.id, field]));
  const visibleFields = blueprint.fields.filter(
    (field) => field.display !== "hidden",
  );

  if (!blueprint.description?.trim()) {
    findings.push(
      finding(
        "missing-description",
        "Add one short sentence explaining what this item type is for.",
        "suggestion",
      ),
    );
  }
  if (!blueprint.styleReference?.trim()) {
    findings.push(
      finding(
        "missing-visual-direction",
        "Choose a visual direction so typography and spacing feel intentional.",
        "suggestion",
      ),
    );
  }
  if (!blueprint.item.showBody && visibleFields.length === 0) {
    findings.push(
      finding(
        "empty-item",
        "Show the document body or at least one visible property.",
        "important",
      ),
    );
  }
  // A type that promises structure and then has no properties at all. The
  // check above only fires when the body is hidden too, so a running tracker
  // came back with no date, no distance and an index that errored, and passed.
  //
  // A plain note is exempt, and deliberately: note shape, plain list, nothing
  // summarised is a legitimate field-less type, which is exactly what the
  // built-in Note is. Flagging it would spend a revision round inventing
  // properties nobody asked for.
  const promisesStructure =
    blueprint.item.shape !== "note" ||
    blueprint.collection.layout !== "list" ||
    blueprint.collection.summaryFields.length > 0;
  if (blueprint.fields.length === 0 && promisesStructure) {
    findings.push(
      finding(
        "no-fields",
        "Give this type the properties it is for. A kind of thing with no properties is just a note.",
        "important",
      ),
    );
  }

  const labels = new Set<string>();
  for (const field of blueprint.fields) {
    const label = field.label.trim().toLocaleLowerCase();
    if (labels.has(label)) {
      findings.push(
        finding(
          "duplicate-label",
          `Rename the repeated ${field.label} property so it is unambiguous.`,
          "important",
        ),
      );
    }
    labels.add(label);
    if (field.display === "cover" && field.type !== "image") {
      findings.push(
        finding(
          "invalid-cover-treatment",
          `${field.label} cannot be the cover because it is not an image.`,
          "important",
        ),
      );
    }
  }

  if (
    (blueprint.item.shape === "article" ||
      blueprint.collection.layout === "cards") &&
    !fields.some((field) => field.type === "image")
  ) {
    findings.push(
      finding(
        "missing-card-media",
        "Add an image property so editorial cards have a strong visual anchor.",
        "suggestion",
      ),
    );
  }

  if (blueprint.collection.layout === "board") {
    const group = blueprint.collection.groupBy
      ? fieldById.get(blueprint.collection.groupBy)
      : null;
    if (!group || group.type !== "enum") {
      findings.push(
        finding(
          "board-without-status",
          "Group a board by a select property with named columns.",
          "important",
        ),
      );
    }
  }

  if (
    blueprint.collection.layout === "calendar" ||
    blueprint.collection.layout === "heatmap"
  ) {
    const date = blueprint.collection.dateBy
      ? fieldById.get(blueprint.collection.dateBy)
      : null;
    if (!date || date.type !== "date") {
      findings.push(
        finding(
          `${blueprint.collection.layout}-without-date`,
          `Choose a date property for the ${blueprint.collection.layout}.`,
          "important",
        ),
      );
    }
  }

  if (blueprint.item.shape === "task") {
    const hasWorkflow = fields.some(
      (field) =>
        (field.type === "enum" && field.options && field.options.length > 1) ||
        (field.type === "boolean" && field.display === "toggle"),
    );
    if (!hasWorkflow) {
      findings.push(
        finding(
          "task-without-workflow",
          "Add a status or completion property so tasks can move through a workflow.",
          "suggestion",
        ),
      );
    }
  }

  if (blueprint.fields.length > 14) {
    findings.push(
      finding(
        "too-many-properties",
        "Move secondary information into sections or remove properties that are not essential.",
        "suggestion",
      ),
    );
  }
  if (blueprint.collection.summaryFields.length > 4) {
    findings.push(
      finding(
        "dense-folder-summary",
        "Keep folder cards scannable with four summary properties or fewer.",
        "suggestion",
      ),
    );
  }

  const important = findings.filter(
    (item) => item.severity === "important",
  ).length;
  const suggestions = findings.length - important;
  const score = Math.max(0, 100 - important * 24 - suggestions * 6);
  return { findings, passes: important === 0 && score >= 76, score };
}

export function itemTypeQualityRevisionPrompt(
  blueprint: ItemTypeBlueprint,
  report: ItemTypeQualityReport,
): string {
  const issues = report.findings
    .map((item) => `- ${item.message}`)
    .join("\n");
  return `Improve this reusable item-type blueprint before showing it to the writer.

Keep the writer's intent and named visual reference. Fix every important issue, simplify where possible, and return the complete corrected JSON object only.

Current blueprint:
${JSON.stringify(blueprint)}

Quality review:
${issues}`;
}
