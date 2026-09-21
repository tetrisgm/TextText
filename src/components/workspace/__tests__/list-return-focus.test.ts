import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { restoreListReturnFocus } from "../useListReturnFocus";

class Row {
  dataset: { returnFocusKey: string };
  isContentEditable = false;
  field = false;
  focus = vi.fn();
  constructor(key: string) { this.dataset = { returnFocusKey: key }; }
  getClientRects() { return [{}]; }
  closest() { return null; }
  matches() { return this.field; }
}
let rows: Row[];
let documentEvents: EventTarget & { activeElement: Row | null };
let mutation: () => void;
let disconnect: () => void;
const container = { querySelectorAll: () => rows } as unknown as HTMLElement;
beforeEach(() => {
  vi.useFakeTimers(); rows = []; disconnect = vi.fn();
  documentEvents = Object.assign(new EventTarget(), { activeElement: null });
  vi.stubGlobal("document", documentEvents);
  vi.stubGlobal("HTMLElement", Row);
  vi.stubGlobal("MutationObserver", class {
    constructor(callback: () => void) { mutation = callback; }
    observe() {}
    disconnect() { disconnect(); }
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("returns to the exact originating row without moving scroll", () => {
  const continued = new Row("continue:same-item");
  const timeline = new Row("timeline:same-item");
  rows = [continued, timeline];
  restoreListReturnFocus(container, "timeline:same-item");
  expect(timeline.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(continued.focus).not.toHaveBeenCalled();
  expect(disconnect).toHaveBeenCalled();
});
it("waits for a saved-reading row to load", () => {
  restoreListReturnFocus(container, "saved:one");
  const row = new Row("saved:one"); rows.push(row); mutation();
  expect(row.focus).toHaveBeenCalledOnce();
});
it.each(["keydown", "pointerdown"])("yields to a new %s gesture while the row is loading", (event) => {
  restoreListReturnFocus(container, "saved:one");
  documentEvents.dispatchEvent(new Event(event));
  const row = new Row("saved:one"); rows.push(row); mutation();
  expect(row.focus).not.toHaveBeenCalled();
});
it("does not steal the caret from a field", () => {
  const field = new Row("field"); field.field = true; documentEvents.activeElement = field;
  const row = new Row("writing:one"); rows.push(row);
  restoreListReturnFocus(container, "writing:one");
  expect(row.focus).not.toHaveBeenCalled();
});
it("stops waiting when the row was removed or another view opens", () => {
  restoreListReturnFocus(container, "deleted");
  vi.advanceTimersByTime(2000);
  const deleted = new Row("deleted"); rows.push(deleted); mutation();
  expect(deleted.focus).not.toHaveBeenCalled();
  const cleanup = restoreListReturnFocus(container, "other"); cleanup();
  const other = new Row("other"); rows.push(other); mutation();
  expect(other.focus).not.toHaveBeenCalled();
});
