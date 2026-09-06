import { expect, it } from "vitest";
import { validateFilterOperand } from "../filter-operand";

it.each(["2024-02-29", "2000-02-29", "2026-09-05", "0099-12-31"])("accepts canonical calendar date %s", value => {
  expect(() => validateFilterOperand({ id: "due", type: "date" }, { op: "gte", value })).not.toThrow();
});
it.each(["1900-02-29", "2026-00-01", "2026-13-01", "2026-04-31", "2026-09-05T00:00:00Z", "2026-9-5", " 2026-09-05", ""])("offers a precise repair for invalid date %s", value => {
  expect(() => validateFilterOperand({ id: "due", type: "date" }, { op: "gte", value }))
    .toThrow(/due.*date string.*YYYY-MM-DD/);
});
it.each(["isSet", "notSet"])("keeps operand-free date operator %s", op => {
  expect(() => validateFilterOperand({ id: "due", type: "date" }, { op })).not.toThrow();
});
