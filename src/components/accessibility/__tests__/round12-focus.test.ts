import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useEffect: (effect: () => void | (() => void)) => { effects.push(effect); } }));
import { dialogControls, useDialogFocus, usePopoverFocus } from "../useDialogFocus";

// An explicit DOM adapter tests the hook's focus policy. Geometry and native Tab
// are separately exercised by the opt-in browser suite, not simulated here.
class Control {
  children: Control[] = [];
  parentElement: Control | null = null;
  inert = false; disabled = false; hidden = false; isConnected = true; tabIndex = 0;
  attributes = new Map<string, string>();
  visible = true;
  constructor(readonly name: string) {}
  append(...children: Control[]) { this.children.push(...children); for (const child of children) child.parentElement = this; return this; }
  contains(node: unknown): boolean { return this === node || this.children.some(child => child.contains(node)); }
  matches(selector: string) { return selector === ':disabled' && this.disabled; }
  closest(selector: string): Control | null {
    if ((selector.includes('[inert]') && this.inert) || (selector.includes('[hidden]') && this.hidden) || (selector.includes('main') && this.name === 'main')) return this;
    return this.parentElement?.closest(selector) ?? null;
  }
  querySelectorAll(): Control[] { return this.children.flatMap(child => [child, ...child.querySelectorAll()]); }
  getClientRects() { return this.visible ? [{}] : []; }
  toggleAttribute(name: string, value: boolean) { if (name === "inert") this.inert = value; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  focus() { if (!this.isConnected || this.disabled || this.closest('[inert]')) return; doc.activeElement = this; }
}
let doc: { body: Control; activeElement: Control; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn>; querySelector: ReturnType<typeof vi.fn> };
const listeners = new Map<string, Set<(event: KeyboardEvent) => void>>();
let mutations: Array<() => void> = [];
let cleanups: Array<() => void> = [];
function mount(root: Control, modal = true) {
  (modal ? useDialogFocus : usePopoverFocus)({ current: root as unknown as HTMLElement }, true);
  const cleanup = effects.pop()?.();
  if (cleanup) cleanups.push(cleanup);
  return () => { if (cleanup) { cleanup(); cleanups = cleanups.filter(fn => fn !== cleanup); } };
}
function pressTab(shiftKey = false) {
  const event = { key: "Tab", shiftKey, preventDefault: vi.fn() };
  listeners.get('keydown')?.forEach(fn => fn(event as unknown as KeyboardEvent));
  return event;
}
beforeEach(() => {
  effects.length = 0; listeners.clear(); mutations = []; cleanups = [];
  const body = new Control('body');
  doc = { body, activeElement: body,
    addEventListener: vi.fn((name, fn) => { const set = listeners.get(name) ?? new Set(); set.add(fn); listeners.set(name, set); }),
    removeEventListener: vi.fn((name, fn) => listeners.get(name)?.delete(fn)), querySelector: vi.fn(() => body.children.find(child => child.name === 'main')) };
  vi.stubGlobal('document', doc); vi.stubGlobal('HTMLElement', Control);
  vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
  vi.stubGlobal('MutationObserver', class { constructor(callback: () => void) { mutations.push(callback); } observe() {} disconnect() {} });
});
afterEach(() => { [...cleanups].reverse().forEach(fn => fn()); vi.unstubAllGlobals(); });

it("R12: overlapping sibling dialogs preserve inert ownership when the lower exit settles first", () => {
  const trigger = new Control("trigger"), lower = new Control("gallery").append(new Control("close gallery"));
  doc.body.append(trigger, lower); trigger.focus(); const closeLower = mount(lower);
  const upper = new Control("palette").append(new Control("search")); doc.body.append(upper);
  const closeUpper = mount(upper);
  closeLower();
  expect.soft(trigger.inert, "background while palette remains open").toBe(true);
  closeUpper();
  expect(trigger.inert, "background after both dialogs close").toBe(false);
});
