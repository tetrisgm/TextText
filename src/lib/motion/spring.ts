/** Pixels (or any scalar) and units/second. Each axis owns its own spring. */
export interface FrameClock {
  request: (frame: (time: number) => void) => number;
  cancel: (id: number) => void;
  now: () => number;
}
export const frameClock: FrameClock = {
  request: (frame) => requestAnimationFrame(frame),
  cancel: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
};
export interface SpringOptions {
  damping?: number;
  response?: number;
  velocity?: number;
  precision?: number;
  clock?: FrameClock;
  onUpdate: (value: number, velocity: number) => void;
  onRest?: () => void;
}

/** Analytic damped oscillator. Retargeting never samples the previous target. */
export function spring(initial: number, options: SpringOptions) {
  const clock = options.clock ?? frameClock;
  let value = initial, velocity = options.velocity ?? 0, target = initial;
  let damping = options.damping ?? 1, response = options.response ?? 0.35;
  const precision = options.precision ?? 0.001;
  let frame: number | null = null, previous = 0, generation = 0;
  if (!Number.isFinite(initial) || !Number.isFinite(velocity) || !(damping > 0 && response > 0)) throw new Error("Invalid spring initial state");
  const stop = () => { generation++; if (frame !== null) clock.cancel(frame); frame = null; };
  const tick = (time: number) => {
    frame = null;
    const revision = generation;
    // A resumed background tab must not jump through seconds of motion.
    const dt = Math.min(0.032, Math.max(0, (time - previous) / 1000));
    previous = time;
    const w = 2 * Math.PI / response, x = value - target;
    if (damping === 1) {
      const b = velocity + w * x, decay = Math.exp(-w * dt);
      value = target + (x + b * dt) * decay;
      velocity = (velocity - w * b * dt) * decay;
    } else if (damping < 1) {
      const wd = w * Math.sqrt(1 - damping * damping), a = damping * w;
      const b = (velocity + a * x) / wd, decay = Math.exp(-a * dt);
      const c = Math.cos(wd * dt), s = Math.sin(wd * dt);
      value = target + decay * (x * c + b * s);
      velocity = decay * ((b * wd - a * x) * c - (x * wd + a * b) * s);
    } else {
      const root = Math.sqrt(damping * damping - 1);
      const r1 = -w * (damping - root), r2 = -w * (damping + root);
      const a = (velocity - r2 * x) / (r1 - r2), b = x - a;
      value = target + a * Math.exp(r1 * dt) + b * Math.exp(r2 * dt);
      velocity = r1 * a * Math.exp(r1 * dt) + r2 * b * Math.exp(r2 * dt);
    }
    if (Math.abs(value - target) < precision && Math.abs(velocity) < precision) {
      value = target; velocity = 0;
      options.onUpdate(value, velocity);
      if (revision === generation) options.onRest?.();
    } else {
      options.onUpdate(value, velocity);
      if (revision === generation) frame = clock.request(tick);
    }
  };
  return {
    get value() { return value; },
    get velocity() { return velocity; },
    get target() { return target; },
    get running() { return frame !== null; },
    to(next: number, config: { velocity?: number; damping?: number; response?: number } = {}) {
      if (!Number.isFinite(next)) throw new Error("Spring target must be finite");
      const nextDamping = config.damping ?? damping, nextResponse = config.response ?? response;
      if (!(nextDamping > 0 && nextResponse > 0) || !Number.isFinite(nextDamping + nextResponse)
        || (config.velocity !== undefined && !Number.isFinite(config.velocity))) throw new Error("Invalid spring configuration");
      damping = nextDamping; response = nextResponse; generation++;
      target = next;
      if (config.velocity !== undefined) velocity = config.velocity;
      if (frame === null) { previous = clock.now(); frame = clock.request(tick); }
    },
    /** A captured pointer writes its presentation value directly, without easing. */
    set(next: number, speed = 0) {
      if (!Number.isFinite(next) || !Number.isFinite(speed)) throw new Error("Invalid spring presentation");
      stop(); value = next; target = next; velocity = speed;
      options.onUpdate(value, velocity);
    },
    stop,
  };
}
export type Spring = ReturnType<typeof spring>;
export const project = (velocity: number, deceleration = 0.998) =>
  (velocity / 1000) * deceleration / (1 - deceleration);
export const rubberBand = (overshoot: number, dimension: number) =>
  dimension <= 0 ? 0 : (overshoot * dimension * 0.55) / (dimension + 0.55 * Math.abs(overshoot));
export function resist(value: number, min: number, max: number) {
  const boundary = Math.min(max, Math.max(min, value));
  return boundary + rubberBand(value - boundary, max - min);
}
/** Inverse resistance keeps a re-grab outside the bounds continuous. */
export function unresist(value: number, min: number, max: number) {
  const boundary = Math.min(max, Math.max(min, value)), offset = value - boundary, dimension = max - min;
  if (!offset || dimension <= 0) return boundary;
  return boundary + offset * dimension / (0.55 * Math.max(0.001, dimension - Math.abs(offset)));
}
export function snap(value: number, velocity: number, targets: readonly number[]) {
  if (!targets.length) throw new Error("Snap needs a target");
  const projected = value + project(velocity);
  return targets.reduce((best, candidate) => Math.abs(candidate - projected) < Math.abs(best - projected) ? candidate : best);
}
