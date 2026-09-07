import { describe, expect, it } from "vitest";
import { spring, project, rubberBand, resist, snap } from "../spring";
import { testClock } from "./fixtures";

describe("presentation springs", () => {
  it.each([0.8, 1, 1.4])("settles at its exact target with damping %s", (damping) => {
    const time = testClock(); const values: number[] = [];
    const motion = spring(0, { clock: time.clock, damping, onUpdate: (v) => values.push(v) });
    motion.to(100); time.settle();
    expect(motion.value).toBe(100); expect(motion.velocity).toBe(0); expect(time.pending).toBe(0);
    if (damping >= 1) expect(values.every((v) => v >= 0 && v <= 100)).toBe(true);
    else expect(values.some((v) => v > 100)).toBe(true);
  });
  it("reverses from the moving presentation value with velocity intact", () => {
    const time = testClock(); const motion = spring(0, { clock: time.clock, onUpdate: () => {} });
    motion.to(100); time.frame(); time.frame();
    const before = { value: motion.value, velocity: motion.velocity };
    motion.to(-50);
    expect(motion.value).toBe(before.value); expect(motion.velocity).toBe(before.velocity);
    expect(time.pending).toBe(1); time.settle(); expect(motion.value).toBe(-50);
  });
  it("hands a drag's velocity to the spring without a seam", () => {
    const time = testClock(); const motion = spring(0, { clock: time.clock, onUpdate: () => {} });
    motion.set(40, 120); motion.to(100, { velocity: 120, damping: 0.8 });
    expect(motion.value).toBe(40); expect(motion.velocity).toBe(120);
    time.frame(0.01); expect((motion.value - 40) / 0.00001).toBeCloseTo(120, 0);
    time.settle(); expect(motion.value).toBe(100);
  });
  it("can be grabbed while moving and produces no abandoned frames", () => {
    const time = testClock(); let updates = 0;
    const motion = spring(0, { clock: time.clock, onUpdate: () => updates++ });
    motion.to(1); time.frame(); motion.set(0.4, -3);
    const captured = updates; time.frame(); expect(updates).toBe(captured);
    expect(time.pending).toBe(0); motion.to(0); time.settle(); expect(motion.value).toBe(0);
  });
  it("bounds a resumed frame and cancels on dispose", () => {
    const a = testClock(), b = testClock();
    const x = spring(0, { clock: a.clock, onUpdate: () => {} }), y = spring(0, { clock: b.clock, onUpdate: () => {} });
    x.to(100); y.to(100); a.frame(10_000); b.frame(32); expect(x.value).toBe(y.value);
    x.stop(); expect(a.pending).toBe(0);
  });
  it("does not change value or allocate a second frame during repeated retargets", () => {
    const time = testClock(); const motion = spring(12, { clock: time.clock, onUpdate: () => {} });
    for (let i = 0; i < 40; i++) { motion.to(i); expect(motion.value).toBe(12); }
    expect(time.pending).toBe(1); time.settle(); expect(motion.value).toBe(39);
  });
  it("rejects invalid targets and configurations", () => {
    const time = testClock(); const motion = spring(0, { clock: time.clock, onUpdate: () => {} });
    expect(() => motion.to(NaN)).toThrow(); expect(() => motion.to(1, { response: 0 })).toThrow();
  });
});

describe("gesture geometry", () => {
  it("uses Apple's per-millisecond deceleration projection", () => {
    expect(project(1000)).toBeCloseTo(499); expect(project(-1000)).toBeCloseTo(-499); expect(project(0)).toBe(0);
  });
  it("snaps to the target nearest the momentum projection", () => {
    expect(snap(350, 400, [280, 360, 480, 600])).toBe(600);
    expect(snap(350, -100, [280, 360, 480, 600])).toBe(280);
    expect(snap(350, 0, [280, 360, 480, 600])).toBe(360);
  });
  it("has symmetric, continuous rubber bands without hard stops", () => {
    expect(rubberBand(100, 320)).toBeCloseTo(46.933333);
    expect(rubberBand(-100, 320)).toBe(-rubberBand(100, 320));
    expect(resist(360, 280, 600)).toBe(360); expect(resist(600.001, 280, 600)).toBeCloseTo(600.00055);
    expect(resist(700, 280, 600)).toBeGreaterThan(600); expect(resist(180, 280, 600)).toBeLessThan(280);
    expect(rubberBand(0, 0)).toBe(0);
  });
});

it("allows a frame callback to retarget or stop without duplicate frames", () => {
  const time = testClock(); let updates = 0;
  const motion = spring(0, { clock: time.clock, onUpdate: () => {
    updates++; if (updates === 1) motion.to(-10); else if (updates === 2) motion.stop();
  } });
  motion.to(10); time.frame(); expect(time.pending).toBe(1); time.frame(); expect(time.pending).toBe(0);
});
