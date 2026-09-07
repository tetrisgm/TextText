import { afterEach, expect, it, vi } from "vitest";
import { installPressFeedback } from "../press";
import { captureMotionOrigin } from "../origin";
import { element, preferences, testClock } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());
function setup(disabled = false) {
  preferences(); const time = testClock(), node = element();
  Object.assign(node, { closest: () => node, matches: (selector: string) => selector.startsWith(":disabled") ? disabled : true });
  vi.stubGlobal("Element", Object);
  vi.stubGlobal("requestAnimationFrame", time.clock.request); vi.stubGlobal("cancelAnimationFrame", time.clock.cancel);
  vi.stubGlobal("performance", { now: time.clock.now });
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { defaultView: win });
  const dispose = installPressFeedback(doc as unknown as Document);
  const dispatch = (type: string, fields: object = {}) => {
    const event = Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, button: 0, clientX: 110, clientY: 90, ...fields });
    Object.defineProperty(event, "target", { value: node }); doc.dispatchEvent(event); return event;
  };
  return { time, node, dispatch, dispose, win };
}
it("delegates pointer-down feedback without consuming click actions, and tracks leaving/reentering", () => {
  const f = setup(); const event = f.dispatch("pointerdown"); expect(event.defaultPrevented).toBe(false);
  expect(f.time.pending).toBe(1); f.time.frame(); const down = Number(f.node.style.scale);
  expect(down).toBeLessThan(1); expect(captureMotionOrigin()?.getBoundingClientRect().left).toBe(100);
  f.dispatch("pointermove", { clientX: 900 }); f.time.settle(); expect(f.node.style.scale).toBe("");
  f.dispatch("pointermove"); f.time.settle(); expect(Number(f.node.style.scale)).toBe(0.96);
  f.dispatch("pointerup"); f.time.settle(); expect(f.node.style.scale).toBe(""); expect(f.node.dataset.motionPress).toBeUndefined(); f.dispose();
});
it("releases on pointer cancellation or window blur and removes every frame on unmount", () => {
  const f = setup(); f.dispatch("pointerdown"); f.time.frame(); f.dispatch("pointercancel"); f.time.settle(); expect(f.node.style.scale).toBe("");
  f.dispatch("pointerdown"); f.time.frame(); f.win.dispatchEvent(new Event("blur")); f.time.settle(); expect(f.node.style.scale).toBe("");
  f.dispatch("pointerdown"); f.dispose(); expect(f.time.pending).toBe(0); expect(f.node.dataset.motionPress).toBeUndefined();
});
it("ignores disabled and non-primary presses", () => {
  const f = setup(true); f.dispatch("pointerdown"); expect(f.time.pending).toBe(0); f.dispose();
  const g = setup(); g.dispatch("pointerdown", { button: 2 }); expect(g.time.pending).toBe(0); g.dispose();
});
it("gives keyboard activation the same reversible feedback", () => {
  const f = setup(); f.dispatch("keydown", { key: " ", repeat: false }); f.time.frame(); expect(Number(f.node.style.scale)).toBeLessThan(1);
  f.dispatch("keyup", { key: " " }); f.time.settle(); expect(f.node.style.scale).toBe(""); f.dispose();
});
