import { vi } from "vitest";
import type { FrameClock } from "../spring";

export function testClock() {
  let time = 0, id = 0;
  const callbacks = new Map<number, (time: number) => void>();
  const clock: FrameClock = {
    request: (callback) => { callbacks.set(++id, callback); return id; },
    cancel: (frame) => { callbacks.delete(frame); }, now: () => time,
  };
  return {
    clock, get pending() { return callbacks.size; },
    frame(ms = 16) {
      time += ms;
      const current = [...callbacks.values()]; callbacks.clear();
      current.forEach((callback) => callback(time));
    },
    settle() { for (let i = 0; callbacks.size && i < 500; i++) this.frame(); if (callbacks.size) throw new Error("Motion did not settle"); },
  };
}
interface TestElement extends EventTarget {
  style: Record<string, string> & { setProperty: (key: string, value: string) => void; getPropertyValue: (key: string) => string; removeProperty: (key: string) => void }; writes: string[]; dataset: Record<string, string>;
  children: TestElement[]; className: string; isConnected: boolean;
  ownerDocument: { createElement: () => TestElement; body: null; documentElement: null };
  getBoundingClientRect: () => { left: number; top: number; width: number; height: number; right: number; bottom: number };
  setAttribute: (name: string, value: string) => void; hasAttribute: (name: string) => boolean;
  closest: (selector: string) => TestElement | null;
  appendChild: (child: TestElement) => void; remove: ReturnType<typeof vi.fn>;
  hidePopover: ReturnType<typeof vi.fn<() => void>>; showPopover: ReturnType<typeof vi.fn<() => void>>;
}
export function element(rect = { left: 100, top: 80, width: 360, height: 200 }): TestElement {
  const values: Record<string, string> = {};
  const writes: string[] = [];
  const style = new Proxy(values, { set: (target, key: string, value: string) => { writes.push(key); target[key] = value; return true; }, get: (target, key: string) => target[key] ?? "" });
  Object.assign(style, {
    setProperty: (key: string, value: string) => { style[key] = value; },
    getPropertyValue: (key: string) => values[key] ?? "",
    removeProperty: (key: string) => { delete values[key]; },
  });
  const children: ReturnType<typeof element>[] = [];
  const attrs = new Map<string, string>();
  const node = Object.assign(new EventTarget(), {
    style: style as TestElement["style"], writes, dataset: {} as Record<string, string>, children, className: "", isConnected: true,
    ownerDocument: { createElement: () => element(), body: null, documentElement: null },
    getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }),
    setAttribute: (name: string, value: string) => { attrs.set(name, value); },
    hasAttribute: (name: string) => attrs.has(name),
    closest: (): TestElement | null => null,
    appendChild: (child: ReturnType<typeof element>) => { children.push(child); },
    remove: vi.fn(), hidePopover: vi.fn<() => void>(), showPopover: vi.fn<() => void>(),
  });
  return node;
}
export const asElement = (node: ReturnType<typeof element>) => node as unknown as HTMLElement;
export function preferences(initial: Partial<Record<string, boolean>> = {}) {
  const lists = new Map<string, MediaQueryList>();
  vi.stubGlobal("matchMedia", (query: string) => {
    if (!lists.has(query)) lists.set(query, Object.assign(new EventTarget(), { matches: initial[query] ?? false, media: query }) as MediaQueryList);
    return lists.get(query);
  });
  return (query: string, matches: boolean) => {
    const list = matchMedia(query);
    Object.assign(list, { matches }); list.dispatchEvent(new Event("change"));
  };
}
