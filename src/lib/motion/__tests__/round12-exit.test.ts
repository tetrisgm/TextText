import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { surfaceMotion } from "../surface";
import { captureMotionOrigin } from "../origin";
import { asElement, element, preferences, testClock } from "./fixtures";

// The same explicit hook harness used by the app's handler tests, with real
// production springs and a deterministic clock. No DOM engine stands in for Safari.
function harness(file = "react.tsx") {
  const time = testClock();
  const cells: unknown[] = [], effects: (() => void)[] = [], cleanups: Array<(() => void) | void> = [];
  let cursor = 0, dirty = false;
  const hooks = {
    useRef: (initial: unknown) => { const i = cursor++; return cells[i] ??= { current: initial }; },
    useState: (initial: unknown) => {
      const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === "function" ? initial() : initial;
      return [cells[i], (next: unknown) => { const value = typeof next === "function" ? next(cells[i]) : next; if (value !== cells[i]) { cells[i] = value; dirty = true; } }];
    },
    useCallback: (fn: unknown, deps: unknown[]) => {
      const i = cursor++; const old = cells[i] as { fn: unknown; deps: unknown[] } | undefined;
      if (old && deps.every((d, j) => d === old.deps[j])) return old.fn;
      cells[i] = { fn, deps }; return fn;
    },
    useLayoutEffect: (fn: () => (() => void) | void, deps?: unknown[]) => {
      const i = cursor++; const old = cells[i] as unknown[] | undefined;
      if (deps && old && deps.every((d, j) => d === old[j])) return;
      cells[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); });
    },
  };
  const exports: Record<string, (...args: unknown[]) => unknown> = {};
  const modules: Record<string, unknown> = { react: hooks,
    "./surface": { surfaceMotion: (node: HTMLElement, options: Parameters<typeof surfaceMotion>[1]) => surfaceMotion(node, { ...options, clock: time.clock }) },
    "./origin": { captureMotionOrigin },
  };
  new Function("exports", "require", ts.transpileModule(readFileSync(`src/lib/motion/${file}`, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText)(exports, (id: string) => { if (!(id in modules)) throw new Error(`Missing ${id}`); return modules[id]; });
  return {
    time,
    render<T>(name: string, ...args: unknown[]): T {
      let result: unknown; let count = 0;
      do { dirty = false; cursor = 0; result = exports[name](...args); if (++count > 10) throw new Error("Render loop"); } while (dirty);
      effects.splice(0).forEach((effect) => effect()); return result as T;
    },
    dispose: () => cleanups.forEach((cleanup) => cleanup?.()),
  };
}
afterEach(() => vi.unstubAllGlobals());

it("R12: an explicitly closed native popover is immediately inert during its retained exit", () => {
  preferences(); const h = harness("popover.ts"), node = element(), button = element();
  vi.stubGlobal("requestAnimationFrame", h.time.clock.request); vi.stubGlobal("cancelAnimationFrame", h.time.clock.cancel);
  vi.stubGlobal("document", Object.assign(new EventTarget(), { activeElement: null }));
  let nativeOpen = false;
  Object.assign(node, { matches: () => nativeOpen, contains: () => false }); Object.assign(button, { focus: vi.fn() });
  node.showPopover.mockImplementation(() => { nativeOpen = true; node.dispatchEvent(Object.assign(new Event("beforetoggle"), { newState: "open" })); });
  node.hidePopover.mockImplementation(() => { nativeOpen = false; });
  const control = h.render<{ close: () => void; open: () => void }>("usePopoverMotion", { current: node }, { current: button });
  control.open(); h.time.settle(); control.close();
  try {
    expect(nativeOpen).toBe(true);
    expect(node.hasAttribute("inert") || Boolean((node as unknown as HTMLElement).inert)).toBe(true);
  } finally { h.dispose(); }
});
it("R12: useExitMotion removes its retained surface from interaction at logical close", () => {
  preferences(); const h = harness(), node = element(), ref = { current: asElement(node) }, onClose = vi.fn();
  const close = h.render<() => void>("useExitMotion", ref, onClose); h.time.settle(); close();
  h.render("useExitMotion", ref, onClose);
  try {
    expect(onClose).not.toHaveBeenCalled();
    expect(node.hasAttribute("inert") || Boolean((node as unknown as HTMLElement).inert)).toBe(true);
  } finally { h.dispose(); }
});
