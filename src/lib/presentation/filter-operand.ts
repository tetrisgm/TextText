type FilterField = {
  id: string;
  type: string;
  multiple?: boolean;
  options?: readonly { value: string }[];
};

/** The query language compares scalar values without coercion. Validate both
 * authoring blueprints and compiled base/saved views against that contract. */
export function validateFilterOperand(
  field: FilterField,
  filter: { op: string; value?: string | number | boolean },
): void {
  if (filter.op === "isSet" || filter.op === "notSet") return;
  const fail = (expected: string): never => {
    throw new Error(`Filter property "${field.id}" expects ${expected}.`);
  };
  if (field.type === "rows" || field.multiple) {
    fail("a single value; use isSet or notSet for a list property");
  }
  if (field.type === "number") {
    if (typeof filter.value !== "number" || !Number.isFinite(filter.value)) fail("a number");
  } else if (field.type === "boolean") {
    if (typeof filter.value !== "boolean") fail("a boolean (true or false)");
  } else {
    if (typeof filter.value !== "string") fail(field.type === "date" ? "a date string" : "a string");
    if (field.type === "enum" && !field.options?.some((option) => option.value === filter.value)) {
      fail("a string matching one of its declared enum options");
    }
  }
}
