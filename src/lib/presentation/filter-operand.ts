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
  } else if (field.type === "date") {
    const value = filter.value;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      fail("a valid ISO date string in YYYY-MM-DD form");
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      fail("a valid ISO date string in YYYY-MM-DD form");
    }
  } else {
    if (typeof filter.value !== "string") fail("a string");
    if (field.type === "enum" && !field.options?.some((option) => option.value === filter.value)) {
      fail("a string matching one of its declared enum options");
    }
  }
}
