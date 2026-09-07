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
describe("React presence lifecycle", () => {
  it("retains the exiting subtree and ignores a stale exit after reopen", () => {
    const h = harness(); type Presence = { present: boolean; onRest: (shown: boolean) => void };
    expect(h.render<Presence>("useMotionPresence", true).present).toBe(true);
    const exiting = h.render<Presence>("useMotionPresence", false); expect(exiting.present).toBe(true);
    expect(h.render<Presence>("useMotionPresence", true).present).toBe(true);
    exiting.onRest(false); expect(h.render<Presence>("useMotionPresence", true).present).toBe(true);
    const closing = h.render<Presence>("useMotionPresence", false); closing.onRest(false);
    expect(h.render<Presence>("useMotionPresence", false).present).toBe(false); h.dispose();
  });
  it("uses the same presentation spring for a controlled open-close-open", () => {
    preferences(); const h = harness(), node = element(), ref = { current: asElement(node) };
    h.render("useSurfaceMotion", ref, true); h.time.frame(); const before = node.style.transform;
    h.render("useSurfaceMotion", ref, false); expect(node.style.transform).toBe(before); h.time.frame();
    const closing = node.style.transform; h.render("useSurfaceMotion", ref, true); expect(node.style.transform).toBe(closing);
    h.time.settle(); expect(node.style.opacity).toBe("1"); h.dispose(); expect(h.time.pending).toBe(0);
  });
  it("waits for settlement before invoking an owner's unmount callback", () => {
    preferences(); const h = harness(), node = element(), ref = { current: asElement(node) }, onClose = vi.fn();
    const close = h.render<() => void>("useExitMotion", ref, onClose); h.time.frame(); close();
    h.render("useExitMotion", ref, onClose); expect(onClose).not.toHaveBeenCalled(); h.time.settle(); expect(onClose).toHaveBeenCalledOnce(); h.dispose();
  });
  it("animates an externally requested exit after asynchronous folder apply", () => {
    preferences(); const h = harness(), node = element(), ref = { current: asElement(node) }, onClose = vi.fn();
    h.render("useExitMotion", ref, onClose, { visible: true }); h.time.settle();
    h.render("useExitMotion", ref, onClose, { visible: false }); expect(onClose).not.toHaveBeenCalled();
    h.time.settle(); expect(onClose).toHaveBeenCalledOnce(); h.dispose();
  });
  it("waits for conditional mounting and cleans frames on unmount", () => {
    preferences(); const h = harness(), node = element(), ref = { current: null as HTMLElement | null };
    h.render("useSurfaceMotion", ref, false, { mounted: false }); expect(h.time.pending).toBe(0);
    ref.current = asElement(node); h.render("useSurfaceMotion", ref, true, { mounted: true }); expect(h.time.pending).toBe(1);
    h.render("useSurfaceMotion", ref, false, { mounted: false }); expect(h.time.pending).toBe(0); h.dispose();
  });
});

describe("native popover lifecycle", () => {
  it("retains the native top layer for exit and reverses it with the trigger or external opener", () => {
    preferences(); const h = harness("popover.ts"), node = element(), button = element();
    vi.stubGlobal("requestAnimationFrame", h.time.clock.request); vi.stubGlobal("cancelAnimationFrame", h.time.clock.cancel);
    const doc = Object.assign(new EventTarget(), { activeElement: null }); vi.stubGlobal("document", doc);
    let nativeOpen = false;
    const native = Object.assign(node, { matches: () => nativeOpen, contains: () => false });
    Object.assign(button, { focus: vi.fn() }); node.setAttribute("popover", "auto");
    node.showPopover.mockImplementation(() => { nativeOpen = true; node.dispatchEvent(Object.assign(new Event("beforetoggle"), { newState: "open" })); });
    node.hidePopover.mockImplementation(() => { nativeOpen = false; node.dispatchEvent(Object.assign(new Event("beforetoggle"), { newState: "closed" })); });
    const control = h.render<{ close: () => void; open: () => void }>("usePopoverMotion", { current: native }, { current: button });
    control.open(); h.time.frame(); h.time.frame(); control.close(); expect(nativeOpen).toBe(true);
    const value = node.style.transform; control.open(); expect(node.style.transform).toBe(value); h.time.settle();
    expect(node.hidePopover).not.toHaveBeenCalled();
    button.dispatchEvent(new Event("click", { cancelable: true })); h.time.frame();
    button.dispatchEvent(new Event("click", { cancelable: true })); h.time.settle(); expect(nativeOpen).toBe(true);
    // The browser closes an auto popover on outside click or Escape. Its
    // non-cancelable beforetoggle must stop, rather than retain, the spring.
    node.hidePopover(); h.time.settle(); expect(node.hidePopover).toHaveBeenCalledOnce();
    control.open(); h.time.frame(); node.hidePopover(); h.time.settle();
    expect(node.hidePopover).toHaveBeenCalledTimes(2); h.dispose(); expect(h.time.pending).toBe(0);
  });
  it("does not reopen when dismissed before the native opening frame", () => {
    preferences(); const h = harness("popover.ts"), node = element(), button = element();
    vi.stubGlobal("requestAnimationFrame", h.time.clock.request); vi.stubGlobal("cancelAnimationFrame", h.time.clock.cancel);
    vi.stubGlobal("document", Object.assign(new EventTarget(), { activeElement: null }));
    Object.assign(node, { matches: () => false, contains: () => false }); Object.assign(button, { focus: vi.fn() });
    node.showPopover.mockImplementation(() => node.dispatchEvent(Object.assign(new Event("beforetoggle"), { newState: "open" })));
    const control = h.render<{ close: () => void; open: () => void }>("usePopoverMotion", { current: node }, { current: button });
    control.open(); control.close(); h.time.settle(); expect(node.hidePopover).toHaveBeenCalledOnce(); h.dispose();
  });
});

it("reverses dismissal if a new inline preview arrives before the old exit settles", () => {
  preferences(); const h = harness(), node = element(), ref = { current: asElement(node) }, onClose = vi.fn();
  const first = {}, second = {};
  const close = h.render<() => void>("useExitMotion", ref, onClose, { identity: first }); h.time.settle(); close();
  h.render("useExitMotion", ref, onClose, { identity: first }); h.time.frame(); const presentation = node.style.transform;
  h.render("useExitMotion", ref, onClose, { identity: second }); expect(node.style.transform).toBe(presentation);
  h.time.settle(); expect(node.style.opacity).toBe("1"); expect(onClose).not.toHaveBeenCalled(); h.dispose();
});

it("carries the lazy rail's live value and velocity through the full component handoff", () => {
  preferences(); const shell = harness(), shellNode = element();
  const snapshot = { current: null as { value: number; velocity: number } | null };
  shell.render("useSurfaceMotion", { current: asElement(shellNode) }, true, { path: "rail", snapshot });
  shell.time.frame(); shell.time.frame(); const before = { ...snapshot.current! }; const transform = shellNode.style.transform;
  shell.dispose();
  const loaded = harness(), loadedNode = element();
  loaded.render("useSurfaceMotion", { current: asElement(loadedNode) }, true, { path: "rail", snapshot });
  expect(loadedNode.style.transform).toBe(transform); expect(snapshot.current).toEqual(before);
  loaded.time.settle(); expect(snapshot.current).toEqual({ value: 1, velocity: 0 }); loaded.dispose();
});

it.each(["rail", "scale", "fade"])("keeps an already-open %s surface fully visible on mount", (path) => {
  const change = preferences(); const h = harness(), node = element(), ref = { current: asElement(node) };
  const opacities: number[] = [];
  const snapshot = { current: null as { value: number; velocity: number } | null };
  Object.defineProperty(snapshot, "current", { get: () => null, set: (value: { value: number }) => opacities.push(value.value) });
  h.render("useSurfaceMotion", ref, true, { path, skipInitial: true, snapshot });
  h.time.settle(); change("(prefers-reduced-motion: reduce)", true);
  expect(opacities.length).toBeGreaterThan(0); expect(opacities.every((value) => value === 1)).toBe(true);
  expect(node.style.opacity).toBe("1"); h.dispose();
});
it("animates a later opening even when initial entry is skipped", () => {
  preferences(); const h = harness(), node = element(), ref = { current: asElement(node) };
  h.render("useSurfaceMotion", ref, false, { path: "rail", skipInitial: true }); h.time.settle();
  h.render("useSurfaceMotion", ref, true, { path: "rail", skipInitial: true }); h.time.frame();
  expect(Number(node.style.opacity)).toBeGreaterThan(0); expect(Number(node.style.opacity)).toBeLessThan(1);
  h.time.settle(); expect(node.style.opacity).toBe("1"); h.dispose();
});
it("gives the shortcuts sheet its own rightward path when the open palette changes mode", () => {
  preferences(); const h = harness(), node = element(), ref = { current: asElement(node) };
  h.render("useSurfaceMotion", ref, true, { path: "scale" }); h.time.settle();
  h.render("useSurfaceMotion", ref, true, { path: "sheet" });
  expect(node.style.transform).toBe("translateX(14px)"); h.time.frame();
  expect(node.style.transform).toMatch(/^translateX/); expect(Number(node.style.opacity)).toBeGreaterThan(0);
  h.time.settle(); expect(node.style.transform).toBe("translateX(0px)"); h.dispose();
});

it("exposes logical closure separately from presence and restores semantics on a replacement preview", () => {
  preferences(); const h = harness(), node = element(), ref = { current: asElement(node) }, onClose = vi.fn();
  type Exit = (() => void) & { open: boolean; closing: boolean };
  const first = {}, second = {};
  const close = h.render<Exit>("useExitMotion", ref, onClose, { identity: first });
  h.time.settle(); expect(close.open).toBe(true); close();
  const closing = h.render<Exit>("useExitMotion", ref, onClose, { identity: first });
  expect(closing.closing).toBe(true); expect(closing.open).toBe(false);
  expect(asElement(node).inert).toBe(true); expect(node.getAttribute("aria-hidden")).toBe("true");
  expect(onClose).not.toHaveBeenCalled();
  const reopened = h.render<Exit>("useExitMotion", ref, onClose, { identity: second });
  expect(reopened.open).toBe(true); expect(reopened.closing).toBe(false);
  expect(asElement(node).inert).toBe(false); expect(node.getAttribute("aria-hidden")).toBe("false");
  h.time.settle(); expect(onClose).not.toHaveBeenCalled(); h.dispose();
});

it("native popover returns focus and aria ownership at logical close, preserving content until rest", () => {
  preferences(); const h = harness("popover.ts"), node = element(), button = element();
  vi.stubGlobal("requestAnimationFrame", h.time.clock.request); vi.stubGlobal("cancelAnimationFrame", h.time.clock.cancel);
  const document = { activeElement: null as unknown }; vi.stubGlobal("document", document);
  let nativeOpen = false;
  Object.assign(node, { matches: () => nativeOpen, contains: (target: unknown) => target === node });
  Object.assign(button, { focus: vi.fn(() => { document.activeElement = button; }) });
  node.showPopover.mockImplementation(() => { nativeOpen = true; node.dispatchEvent(Object.assign(new Event("beforetoggle"), { newState: "open" })); });
  node.hidePopover.mockImplementation(() => { nativeOpen = false; });
  const ref = { current: node }, trigger = { current: button };
  type Control = { open: () => void; close: () => void; logicalOpen: boolean; closing: boolean; present: boolean };
  const control = h.render<Control>("usePopoverMotion", ref, trigger);
  control.open(); h.time.settle(); document.activeElement = node; control.close();
  const closing = h.render<Control>("usePopoverMotion", ref, trigger);
  expect(document.activeElement).toBe(button);
  expect(closing).toMatchObject({ logicalOpen: false, closing: true, present: true });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(node.getAttribute("aria-hidden")).toBe("true"); expect(asElement(node).inert).toBe(true);
  expect(nativeOpen).toBe(true);
  control.open();
  expect(node.getAttribute("aria-hidden")).toBe("false"); expect(asElement(node).inert).toBe(false);
  h.time.settle(); expect(nativeOpen).toBe(true);
  control.close(); h.time.settle();
  expect(h.render<Control>("usePopoverMotion", ref, trigger).present).toBe(false);
  expect(nativeOpen).toBe(false); h.dispose();
});
