import { afterEach, describe, expect, it, vi } from "vitest";
import { surfaceMotion } from "../surface";
import { railResize, type RailPointer } from "../rail";
import { pressMotion } from "../press";
import { retainItems, tabPosition } from "../tabs";
import { preferenceQueries } from "../preferences";
import { asElement, element, preferences, testClock } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());
describe("surface presence and materials", () => {
  it("materializes and reverses on the same anchored path without jumping", () => {
    preferences(); const time = testClock(), node = element(), trigger = element({ left: 300, top: 50, width: 40, height: 20 });
    const rest = vi.fn(); const control = surfaceMotion(asElement(node), { clock: time.clock, origin: asElement(trigger), onRest: rest });
    control.show(true); time.frame(); time.frame();
    const presentation = node.style.transform, origin = node.style.transformOrigin;
    expect(origin).toBe("220px -20px");
    control.show(false); expect(node.style.transform).toBe(presentation);
    time.frame(); const closing = node.style.transform;
    control.show(true); expect(node.style.transform).toBe(closing); expect(node.style.transformOrigin).toBe(origin);
    time.settle(); expect(node.style.opacity).toBe("1"); expect(node.style.willChange).toBe("");
    expect(node.style.getPropertyValue("--motion-material-opacity")).toBe("0"); expect(node.children).toHaveLength(0); expect(rest).toHaveBeenCalledTimes(1);
    control.show(false); time.settle(); expect(node.style.visibility).toBe("hidden");
    expect(rest).toHaveBeenLastCalledWith(false); control.dispose(); expect(time.pending).toBe(0);
  });
  it("only writes transform and opacity on animation frames", () => {
    preferences(); const time = testClock(), node = element();
    const control = surfaceMotion(asElement(node), { clock: time.clock });
    control.show(true); node.writes.length = 0; time.frame();
    expect(new Set(node.writes)).toEqual(new Set(["transform", "opacity", "--motion-material-opacity"]));
    expect(node.writes).not.toContain("filter"); control.dispose();
  });
  it("reduced motion is a short monotonic crossfade, including a live preference change", () => {
    const change = preferences({ [preferenceQueries.reducedMotion]: true });
    const time = testClock(), node = element();
    const control = surfaceMotion(asElement(node), { clock: time.clock }); control.show(true);
    for (let i = 0; i < 10; i++) { time.frame(); expect(node.style.transform).toBe("none"); expect(Number(node.style.opacity)).toBeLessThanOrEqual(1); }
    expect(Number(node.style.opacity)).toBeGreaterThan(0.999);
    change(preferenceQueries.reducedMotion, false); expect(node.style.transform).toContain("scale");
    change(preferenceQueries.reducedMotion, true); expect(node.style.transform).toBe("none"); control.dispose();
  });
  it("responds live to reduced transparency and increased contrast", () => {
    const change = preferences(); const node = element(); const time = testClock();
    const control = surfaceMotion(asElement(node), { clock: time.clock });
    change(preferenceQueries.reducedTransparency, true); expect(node.dataset.motionSolid).toBe("true");
    change(preferenceQueries.contrast, true); expect(node.dataset.motionContrast).toBe("true");
    change(preferenceQueries.reducedTransparency, false); expect(node.dataset.motionSolid).toBe("false");
    control.dispose(); expect(node.dataset).toEqual({});
  });
  it("slides the rail on a horizontal spring and fades the backdrop without scaling", () => {
    preferences(); const time = testClock(), rail = element(), backdrop = element();
    const a = surfaceMotion(asElement(rail), { clock: time.clock, path: "rail" });
    const b = surfaceMotion(asElement(backdrop), { clock: time.clock, path: "fade" });
    a.show(true); b.show(true); time.frame(); expect(rail.style.transform).toMatch(/^translateX/);
    expect(backdrop.style.transform).toBe("none"); a.dispose(); b.dispose();
  });
});

function resizeFixture() {
  preferences(); const time = testClock(), node = element(); const commit = vi.fn();
  const root = element(), shell = element();
  node.closest = (selector) => selector === "[data-assistant-sidebar]" ? root : shell;
  const control = railResize(asElement(node), { width: 360, min: 280, max: 600, clock: time.clock, commit });
  const captured = new Set<number>(); const target = { setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id), releasePointerCapture: (id: number) => captured.delete(id) };
  const pointer = (x: number, timeStamp: number, pointerId = 1): RailPointer => ({ clientX: x, timeStamp, pointerId, button: 0, currentTarget: target, preventDefault: vi.fn() });
  return { time, node, root, shell, commit, control, captured, pointer };
}
describe("assistant resize", () => {
  it("captures the pointer and tracks it 1:1 from the grab offset", () => {
    const f = resizeFixture(); f.control.down(f.pointer(204, 0)); expect(f.captured.has(1)).toBe(true);
    f.control.move(f.pointer(184, 16)); expect(f.control.motion.value).toBe(380);
    expect(f.root.style.getPropertyValue("--assistant-sidebar-width")).toBe("380px");
    expect(f.shell.style.getPropertyValue("--workspace-assistant-width")).toBe("380px");
    expect(f.node.style.scale).toBe("");
    expect(f.commit).not.toHaveBeenCalled(); expect(f.node.writes).not.toContain("width"); f.control.dispose();
  });
  it("rubber bands at both ends instead of clamping", () => {
    const f = resizeFixture(); f.control.down(f.pointer(200, 0));
    f.control.move(f.pointer(-100, 16)); expect(f.control.motion.value).toBeGreaterThan(600); expect(f.control.motion.value).toBeLessThan(660);
    f.control.move(f.pointer(400, 32)); expect(f.control.motion.value).toBeLessThan(280); expect(f.control.motion.value).toBeGreaterThan(160); f.control.dispose();
  });
  it("keeps an arbitrary release width without a fling and commits exactly once", () => {
    const f = resizeFixture(); f.control.down(f.pointer(200, 0)); f.control.move(f.pointer(180, 40));
    const before = f.control.motion.value; f.control.up(f.pointer(180, 42));
    expect(f.control.motion.value).toBe(before); expect(f.control.motion.velocity).toBe(0); expect(f.control.motion.target).toBe(380);
    expect(f.captured.size).toBe(0); expect(f.commit).toHaveBeenCalledExactlyOnceWith(380);
    f.time.settle(); expect(f.commit).toHaveBeenCalledTimes(1);
    f.control.sync(380, 280, 600); expect(f.node.style.scale).toBe(""); f.control.dispose();
  });
  it("can regrab mid-snap without a jump or an old commit", () => {
    const f = resizeFixture(); f.control.keyboard(480); f.time.frame();
    const before = f.control.motion.value; f.control.down(f.pointer(150, 80)); expect(f.control.motion.value).toBe(before);
    f.control.move(f.pointer(140, 96)); expect(f.control.motion.value).toBeCloseTo(before + 10); expect(f.commit).not.toHaveBeenCalled(); f.control.dispose();
  });
  it("ignores other pointers, cancels capture without a fling, and ignores stationary holds", () => {
    const f = resizeFixture(); f.control.down(f.pointer(200, 0)); f.control.move(f.pointer(0, 16, 2)); expect(f.control.motion.value).toBe(360);
    f.control.move(f.pointer(180, 40)); f.control.cancel(f.pointer(180, 42)); expect(f.control.motion.velocity).toBe(0); f.time.settle();
    expect(f.commit).toHaveBeenCalledExactlyOnceWith(380); f.control.dispose();
    const g = resizeFixture(); g.control.down(g.pointer(200, 0)); g.control.move(g.pointer(180, 40)); g.control.up(g.pointer(180, 200));
    expect(g.control.motion.velocity).toBe(0); expect(g.control.motion.target).toBe(380); g.control.dispose();
  });
  it("does not commit a click, and disposes capture and queued frames", () => {
    const f = resizeFixture(); f.control.down(f.pointer(200, 0)); f.control.up(f.pointer(200, 10)); f.time.settle(); expect(f.commit).not.toHaveBeenCalled();
    f.control.down(f.pointer(200, 30)); f.control.dispose(); expect(f.captured.size).toBe(0); expect(f.time.pending).toBe(0);
  });
  it("keyboard resizing is critically damped and bounded", () => {
    const f = resizeFixture(); f.control.keyboard(800); f.time.settle(); expect(f.commit).toHaveBeenCalledExactlyOnceWith(600); f.control.dispose();
  });
});

describe("tabs and press feedback", () => {
  it("retains exiting tabs and reuses an id when reopened mid-exit", () => {
    const a = { id: "a" }, b = { id: "b" };
    const removed = retainItems([{ item: a, present: true }, { item: b, present: true }], [b]);
    expect(removed).toEqual([{ item: a, present: false }, { item: b, present: true }]);
    const reopened = retainItems(removed, [a, b]); expect(reopened).toHaveLength(2); expect(reopened.every((entry) => entry.present)).toBe(true);
  });
  it("absorbs tab reflow with independent live X and Y springs", () => {
    preferences(); const time = testClock(), node = element(); const control = tabPosition(asElement(node), time.clock);
    control.move(120, 20); expect(node.style.translate).toBe("120px 20px"); time.frame();
    const x = control.x.value, y = control.y.value, velocity = control.x.velocity;
    control.move(-30, 0); expect(control.x.value).toBe(x - 30); expect(control.y.value).toBe(y); expect(control.x.velocity).toBe(velocity);
    time.settle(); expect(node.style.translate).toBe("0px 0px"); control.dispose();
  });
  it("press feedback starts on down and reverses from the current value", () => {
    preferences(); const time = testClock(), node = element(); const control = pressMotion(asElement(node), time.clock);
    control.press(true); expect(time.pending).toBe(1); time.frame(); expect(Number(node.style.scale)).toBeLessThan(1);
    const value = control.motion.value; control.press(false); expect(control.motion.value).toBe(value); time.settle(); expect(node.style.scale).toBe(""); expect(node.style.willChange).toBe(""); control.dispose();
  });
  it("reduced motion press feedback crossfades without shrinking", () => {
    preferences({ [preferenceQueries.reducedMotion]: true }); const time = testClock(), node = element(); const control = pressMotion(asElement(node), time.clock);
    control.press(true); time.frame(); expect(node.style.scale).toBe(""); expect(Number(node.style.opacity)).toBeLessThan(1); control.dispose();
  });
});

it("regrabs inside the rubber band without applying resistance twice", () => {
  const f = resizeFixture(); f.control.down(f.pointer(200, 0)); f.control.move(f.pointer(-100, 16));
  f.control.up(f.pointer(-100, 18)); const before = f.control.motion.value;
  f.control.down(f.pointer(-100, 20)); f.control.move(f.pointer(-100, 30)); expect(f.control.motion.value).toBeCloseTo(before);
  f.control.dispose();
});
it("resumes a grabbed snap when the pointer is released without moving", () => {
  const f = resizeFixture(); f.control.keyboard(480); f.time.frame();
  const before = f.control.motion.value; f.control.down(f.pointer(200, 30)); f.control.up(f.pointer(200, 40));
  expect(f.control.motion.value).toBe(before); f.time.settle(); expect(f.commit).toHaveBeenCalledExactlyOnceWith(480); f.control.dispose();
});
it("reduced motion resize preserves an in-range release without further motion", () => {
  const f = resizeFixture(); preferences({ [preferenceQueries.reducedMotion]: true });
  f.control.down(f.pointer(200, 0)); f.control.move(f.pointer(180, 40)); f.control.up(f.pointer(180, 42));
  expect(f.control.motion.running).toBe(false); expect(f.control.motion.velocity).toBe(0);
  expect(f.commit).toHaveBeenCalledExactlyOnceWith(380); expect(f.node.style.opacity).toBe("");
  f.time.settle(); expect(f.node.style.opacity).toBe(""); f.control.dispose();
});

it("accumulates keyboard resize steps while an earlier step is in flight", () => {
  const f = resizeFixture(); f.control.keyboard((target) => target + 16); f.time.frame();
  f.control.keyboard((target) => target + 16); f.control.keyboard((target) => target + 16);
  expect(f.control.motion.target).toBe(408); f.time.settle(); expect(f.commit).toHaveBeenCalledExactlyOnceWith(408); f.control.dispose();
});
it("changes an active resize snap to a crossfade when reduced motion changes live", () => {
  const f = resizeFixture(); const change = preferences();
  // Recreate the controller after installing this observable preference source.
  f.control.dispose(); const control = railResize(asElement(f.node), { width: 360, min: 280, max: 600, clock: f.time.clock, commit: f.commit });
  control.keyboard(480); f.time.frame(); change(preferenceQueries.reducedMotion, true);
  expect(control.motion.running).toBe(false); expect(f.commit).toHaveBeenCalledExactlyOnceWith(480); f.time.settle(); control.dispose();
});

it("keeps tabs out of solid, contrast and material treatment for live accessibility preferences", () => {
  const change = preferences(); const time = testClock(), node = element();
  const child = element(); node.appendChild(child);
  const control = surfaceMotion(asElement(node), { initial: 1, material: false, clock: time.clock });
  control.show(true); time.settle();
  change(preferenceQueries.reducedTransparency, true); change(preferenceQueries.contrast, true);
  expect(node.dataset.motionSolid).toBeUndefined(); expect(node.dataset.motionContrast).toBeUndefined();
  expect(node.dataset.motionMaterial).toBeUndefined(); expect(node.children).toEqual([child]);
  expect(node.style.getPropertyValue("--motion-material-opacity")).toBe("");
  control.dispose(); expect(node.children).toEqual([child]);
});
it.each([297, 381, 437, 559])("lets pointer and keyboard select the same arbitrary width %i", (width) => {
  const f = resizeFixture(); f.control.down(f.pointer(200, 0)); f.control.move(f.pointer(560 - width, 16));
  f.control.up(f.pointer(560 - width, 18)); f.time.settle();
  expect(f.commit).toHaveBeenCalledExactlyOnceWith(width); f.control.dispose();
  const g = resizeFixture(); g.control.keyboard(width); g.time.settle();
  expect(g.commit).toHaveBeenCalledExactlyOnceWith(width); g.control.dispose();
});
it("hands boundary release velocity to recovery without quantizing in-range widths", () => {
  const f = resizeFixture(); f.control.down(f.pointer(200, 0)); f.control.move(f.pointer(-100, 40));
  const before = f.control.motion.value, velocity = f.control.motion.velocity;
  f.control.up(f.pointer(-100, 42)); expect(f.control.motion.value).toBe(before);
  expect(f.control.motion.velocity).toBe(velocity); expect(f.control.motion.target).toBe(600);
  expect(f.commit).not.toHaveBeenCalled(); f.time.settle(); expect(f.commit).toHaveBeenCalledExactlyOnceWith(600); f.control.dispose();
});
it("restores the latest committed layout on cleanup, including after an interrupted drag", () => {
  const f = resizeFixture(); f.control.down(f.pointer(200, 0)); f.control.move(f.pointer(180, 16)); f.control.up(f.pointer(180, 18));
  f.control.sync(380, 280, 600); f.control.down(f.pointer(180, 20)); f.control.move(f.pointer(160, 36));
  f.control.dispose(); expect(f.root.style.getPropertyValue("--assistant-sidebar-width")).toBe("380px");
  expect(f.shell.style.getPropertyValue("--workspace-assistant-width")).toBe("380px");
});
