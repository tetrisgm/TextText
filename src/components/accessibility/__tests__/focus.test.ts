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
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
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
describe("production dialog focus policy", () => {
  it("uses rendered order and excludes disabled, hidden, inert and negative-tabindex controls", () => {
    const root = new Control('dialog');
    const first = new Control('first'), last = new Control('last');
    const disabled = new Control('disabled'); disabled.disabled = true;
    const hidden = new Control('hidden'); hidden.visible = false;
    const negative = new Control('negative'); negative.tabIndex = -1;
    const inert = new Control('inert'); inert.inert = true;
    root.append(first, disabled, hidden, negative, inert, last);
    expect(dialogControls(root as unknown as HTMLElement)).toEqual([first, last]);
  });
  it("sets entry focus, wraps forward and backward, and restores the trigger", () => {
    const trigger = new Control('trigger'), first = new Control('first'), last = new Control('last');
    const root = new Control('dialog').append(first, last); doc.body.append(trigger, root); trigger.focus();
    const close = mount(root);
    expect(doc.activeElement).toBe(first); expect(trigger.inert).toBe(true);
    expect(pressTab(true).preventDefault).toHaveBeenCalledOnce(); expect(doc.activeElement).toBe(last);
    expect(pressTab().preventDefault).toHaveBeenCalledOnce(); expect(doc.activeElement).toBe(first);
    close(); expect(doc.activeElement).toBe(trigger); expect(trigger.inert).toBe(false);
  });
  it("nested dialogs restore their parent before the original opener", () => {
    const trigger = new Control('trigger'), button = new Control('open nested'), childButton = new Control('child');
    const inner = new Control('inner').append(childButton), outer = new Control('outer').append(button, inner);
    inner.tabIndex = -1; inner.visible = false; childButton.visible = false;
    doc.body.append(trigger, outer); trigger.focus(); const closeOuter = mount(outer);
    inner.visible = true; childButton.visible = true; const closeInner = mount(inner);
    expect(doc.activeElement).toBe(childButton);
    pressTab(); expect(doc.activeElement).toBe(childButton);
    closeInner(); expect(doc.activeElement).toBe(button);
    closeOuter(); expect(doc.activeElement).toBe(trigger);
  });
  it("recovers focus after a control is removed or disabled during async work", () => {
    const first = new Control('close'), submit = new Control('submit'), root = new Control('dialog').append(first, submit);
    doc.body.append(root); mount(root); submit.focus(); submit.disabled = true;
    mutations.forEach(fn => fn()); expect(doc.activeElement).toBe(first);
    doc.activeElement = doc.body; root.children.pop(); mutations.forEach(fn => fn()); expect(doc.activeElement).toBe(first);
  });
  it("uses the dialog itself when all controls are disabled", () => {
    const button = new Control('busy'); button.disabled = true;
    const root = new Control('dialog').append(button); doc.body.append(root); mount(root);
    pressTab(); expect(doc.activeElement).toBe(root);
  });
  it("returns to a surviving landmark when the original trigger disappears", () => {
    const trigger = new Control('trigger'), main = new Control('main').append(trigger), root = new Control('dialog').append(new Control('close'));
    doc.body.append(main, root); trigger.focus(); const close = mount(root);
    trigger.isConnected = false; close(); expect(doc.activeElement).toBe(main);
  });
  it("preserves prior inert state after closing", () => {
    const background = new Control('already inert'); background.inert = true;
    const root = new Control('dialog').append(new Control('close')); doc.body.append(background, root); const close = mount(root); close();
    expect(background.inert).toBe(true);
  });
  it("nonmodal popovers permit focus to leave and do not steal it on light dismissal", () => {
    const trigger = new Control('trigger'), outside = new Control('outside'), root = new Control('popover').append(new Control('close'));
    doc.body.append(trigger, outside, root); trigger.focus(); const close = mount(root, false);
    expect(trigger.inert).toBe(false); expect(listeners.size).toBe(0);
    outside.focus(); close(); expect(doc.activeElement).toBe(outside);
  });
  it("nonmodal Escape cleanup returns focus to its opener", () => {
    const trigger = new Control('trigger'), root = new Control('popover').append(new Control('close'));
    doc.body.append(trigger, root); trigger.focus(); const close = mount(root, false); close(); expect(doc.activeElement).toBe(trigger);
  });
});

it("menu arrows and Home/End traverse only enabled visible controls", async () => {
  const { moveMenuFocus } = await import("../keyboard");
  const a = new Control("first"), b = new Control("disabled"), c = new Control("last"); b.disabled = true;
  const menu = new Control("menu").append(a, b, c); doc.body.append(menu); a.focus();
  const key = (key: string) => ({ key, preventDefault: vi.fn(), stopPropagation: vi.fn() });
  moveMenuFocus(menu as unknown as HTMLElement, key("ArrowDown")); expect(doc.activeElement).toBe(c);
  moveMenuFocus(menu as unknown as HTMLElement, key("ArrowDown")); expect(doc.activeElement).toBe(a);
  moveMenuFocus(menu as unknown as HTMLElement, key("End")); expect(doc.activeElement).toBe(c);
  moveMenuFocus(menu as unknown as HTMLElement, key("Home")); expect(doc.activeElement).toBe(a);
});
it("Escape closes the nearest open disclosure and returns focus to its summary", async () => {
  const { dismissOpenDetails } = await import("../keyboard");
  const summary = new Control("summary"), input = new Control("input");
  const details = { open: true, querySelector: () => summary };
  input.closest = () => details as unknown as Control;
  const event = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
  expect(dismissOpenDetails(input as unknown as EventTarget, event)).toBe(true);
  expect(details.open).toBe(false); expect(doc.activeElement).toBe(summary);
  expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce();
});


it.each(["upper", "lower"])("overlapping modal branches restore only their original inert values when %s closes first", first => {
  const trigger = new Control("trigger"), permanent = new Control("permanent"); permanent.inert = true;
  const lower = new Control("lower").append(new Control("lower close"));
  const upper = new Control("upper").append(new Control("upper close"));
  const upperBranch = new Control("portal").append(upper);
  doc.body.append(trigger, permanent, lower, upperBranch); trigger.focus();
  const closeLower = mount(lower); expect(upperBranch.inert).toBe(true);
  const closeUpper = mount(upper); expect(upperBranch.inert).toBe(false);
  expect(doc.activeElement).toBe(upper.children[0]);
  if (first === "lower") { closeLower(); expect(trigger.inert).toBe(true); closeUpper(); }
  else { closeUpper(); expect(trigger.inert).toBe(true); closeLower(); }
  expect(trigger.inert).toBe(false); expect(permanent.inert).toBe(true); expect(upperBranch.inert).toBe(false);
});

it("keeps a logically closed lower surface inert after the upper modal exits", () => {
  const lower = new Control("lower").append(new Control("lower close"));
  const upper = new Control("upper").append(new Control("upper close"));
  doc.body.append(lower, upper); const closeLower = mount(lower), closeUpper = mount(upper);
  lower.attributes.set("aria-hidden", "true"); lower.inert = true;
  closeLower(); closeUpper();
  expect(lower.inert).toBe(true); expect(upper.inert).toBe(false);
});
