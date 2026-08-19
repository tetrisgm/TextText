import type { DocumentFieldDefinition } from "@/lib/presentation/schema";

type EnumField = Extract<DocumentFieldDefinition, { type: "enum" }>;
type EnumOption = EnumField["options"][number];

export type StatusWorkflowOptions = {
  current: EnumOption | { value: string; label: string } | null;
  next: EnumOption[];
  initial: EnumOption | null;
};

/**
 * Resolve the only status values the editor may offer from the current state.
 * Unknown legacy values stay visible but cannot silently bypass the graph.
 */
export function statusWorkflowOptions(
  field: EnumField,
  currentValue: unknown,
): StatusWorkflowOptions | null {
  if (field.semantic !== "status" || !field.workflow || field.multiple) {
    return null;
  }

  const optionByValue = new Map(
    field.options.map((option) => [option.value, option] as const),
  );
  const initial = optionByValue.get(field.workflow.initial) ?? null;
  const currentValueString =
    typeof currentValue === "string" && currentValue.trim()
      ? currentValue
      : null;
  const current = currentValueString
    ? (optionByValue.get(currentValueString) ?? {
        value: currentValueString,
        label: currentValueString,
      })
    : null;

  if (!currentValueString) {
    return { current, next: initial ? [initial] : [], initial };
  }

  const seen = new Set<string>();
  const next: EnumOption[] = [];
  for (const transition of field.workflow.transitions) {
    if (transition.from !== currentValueString || seen.has(transition.to)) {
      continue;
    }
    const option = optionByValue.get(transition.to);
    if (!option) continue;
    seen.add(option.value);
    next.push(option);
  }
  return { current, next, initial };
}

