import { spring, resist, unresist, type FrameClock } from "./spring";
import { observePreferences, readPreferences } from "./preferences";

export interface RailPointer {
  pointerId: number; clientX: number; timeStamp: number; button: number;
  currentTarget: { setPointerCapture: (id: number) => void; hasPointerCapture: (id: number) => boolean; releasePointerCapture: (id: number) => void };
  preventDefault: () => void;
}
/** Live layout preview; persistence is committed once on release or settlement. */
export function railResize(node: HTMLElement, options: {
  width: number; min: number; max: number; commit: (width: number) => void;
  clock?: FrameClock;
}) {
  let base = options.width;
  let min = options.min, max = options.max;
  let gesture: { id: number; x: number; width: number; lastTime: number; lastWidth: number;
    velocity: number; capture: RailPointer["currentTarget"]; moved: boolean; resume: number | null; resumeVelocity: number } | null = null;
  let pending = false;
  const savedOpacity = node.style.opacity;
  const fade = spring(1, { clock: options.clock, response: 0.08, onUpdate: (value) => { node.style.opacity = String(value); }, onRest: () => { node.style.opacity = savedOpacity; node.style.willChange = ""; } });
  // Resize both clipping boxes, without scaling their text or persisting samples.
  const root = node.closest<HTMLElement>("[data-assistant-sidebar]") ?? node;
  const shell = node.closest<HTMLElement>(".post-editor-shell");
  const targets = [
    { node: root, property: "--assistant-sidebar-width" },
    ...(shell ? [{ node: shell, property: "--workspace-assistant-width" }] : []),
  ].map((entry) => ({ ...entry, saved: entry.node.style.getPropertyValue(entry.property), last: "" }));
  const paint = (width: number) => {
    for (const entry of targets) {
      entry.last = `${width}px`;
      entry.node.style.setProperty(entry.property, entry.last);
    }
  };
  const commitWidth = (value: number) => {
    const width = Math.round(value);
    paint(width);
    for (const entry of targets) entry.saved = `${width}px`;
    options.commit(width);
  };
  const motion = spring(base, {
    clock: options.clock, precision: 0.05, onUpdate: paint,
    onRest: () => {
      node.style.willChange = "";
      if (pending) { pending = false; commitWidth(motion.value); }
    },
  });
  const crossfadeLanding = (target: number) => {
    pending = false; motion.set(target); commitWidth(target);
    node.style.willChange = "opacity"; fade.set(0.85); fade.to(1);
  };
  const unsubscribe = observePreferences((prefs) => {
    if (prefs.reducedMotion && pending && motion.running && !gesture) crossfadeLanding(motion.target);
  });
  const release = (event: RailPointer, cancelled: boolean) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const session = gesture;
    // A stationary hold must not fling with an old sample's velocity.
    const velocity = cancelled || event.timeStamp - session.lastTime > 80 ? 0 : session.velocity;
    gesture = null;
    delete node.dataset.motionResizing;
    if (session.capture.hasPointerCapture(session.id)) session.capture.releasePointerCapture(session.id);
    if (!session.moved) {
      if (session.resume !== null) { pending = true; motion.to(session.resume, { velocity: event.timeStamp - session.lastTime > 80 ? 0 : session.resumeVelocity }); }
      else node.style.willChange = "";
      return;
    }
    pending = true;
    const target = Math.min(max, Math.max(min, motion.value));
    if (target === motion.value) {
      // An in-range release keeps the exact width selected by the pointer.
      pending = false; motion.set(target); commitWidth(target);
    } else if (readPreferences().reducedMotion) {
      crossfadeLanding(target);
    } else motion.to(target, { velocity, damping: !velocity ? 1 : 0.8, response: 0.35 });
  };
  return {
    motion,
    sync(width: number, minimum: number, maximum: number) {
      min = minimum; max = maximum;
      for (const entry of targets) entry.saved = `${width}px`;
      if (width !== base) {
        base = width;
        if (!gesture && !motion.running) motion.set(width);
        else paint(motion.value);
      }
      if (pending && !gesture && (motion.target < min || motion.target > max)) motion.to(Math.min(max, Math.max(min, motion.target)));
    },
    down(event: RailPointer) {
      if (event.button !== 0 || gesture) return;
      event.preventDefault();
      const measuredWidth = node.getBoundingClientRect().width;
      const layoutWidth = node.offsetWidth;
      if (layoutWidth > 0 && Math.abs(layoutWidth - base) > 0.5) { base = layoutWidth; motion.set(measuredWidth, motion.velocity); }
      const resume = pending ? motion.target : null, resumeVelocity = motion.velocity;
      pending = false;
      motion.stop();
      gesture = { id: event.pointerId, x: event.clientX, width: unresist(motion.value, min, max),
        lastTime: event.timeStamp, lastWidth: motion.value, velocity: 0, capture: event.currentTarget, moved: false, resume, resumeVelocity };
      node.dataset.motionResizing = "true";
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    move(event: RailPointer) {
      if (!gesture || gesture.id !== event.pointerId) return;
      event.preventDefault();
      const value = resist(gesture.width + gesture.x - event.clientX, min, max);
      const dt = event.timeStamp - gesture.lastTime;
      if (dt > 0) gesture.velocity = (value - gesture.lastWidth) * 1000 / dt;
      gesture.lastTime = event.timeStamp; gesture.lastWidth = value; gesture.moved = true;
      motion.set(value, gesture.velocity);
    },
    up: (event: RailPointer) => release(event, false),
    cancel: (event: RailPointer) => release(event, true),
    keyboard(next: number | ((target: number) => number)) {
      const width = typeof next === "function" ? next(motion.target) : next;
      pending = true;
      const target = Math.min(max, Math.max(min, width));
      if (readPreferences().reducedMotion) {
        crossfadeLanding(target);
      } else motion.to(target, { damping: 1, response: 0.35 });
    },
    dispose() {
      const session = gesture;
      gesture = null;
      if (session?.capture.hasPointerCapture(session.id)) session.capture.releasePointerCapture(session.id);
      motion.stop(); fade.stop(); unsubscribe();
      node.style.opacity = savedOpacity;
      node.style.willChange = "";
      for (const entry of targets) {
        if (entry.node.style.getPropertyValue(entry.property) !== entry.last) continue;
        if (entry.saved) entry.node.style.setProperty(entry.property, entry.saved);
        else entry.node.style.removeProperty(entry.property);
      }
      delete node.dataset.motionResizing;
    },
  };
}
