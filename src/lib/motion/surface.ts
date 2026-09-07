import type { MotionOrigin } from "./origin";
import { spring, type FrameClock } from "./spring";
import { observePreferences } from "./preferences";

export interface MotionSnapshot { value: number; velocity: number }

/** A fixed blur material is composited away with opacity, never animated filter. */
export function surfaceMotion(node: HTMLElement, options: {
  initial?: number; velocity?: number; onUpdate?: (snapshot: MotionSnapshot) => void; origin?: MotionOrigin | null; path?: "scale" | "rail" | "sheet" | "fade"; material?: boolean;
  clock?: FrameClock; onRest?: (shown: boolean) => void;
} = {}) {
  let reduced = false, shown = (options.initial ?? 0) === 1;
  const saved = { transform: node.style.transform, opacity: node.style.opacity, willChange: node.style.willChange,
    transformOrigin: node.style.transformOrigin, visibility: node.style.visibility };
  const material = options.material !== false;
  const savedMaterialOpacity = node.style.getPropertyValue("--motion-material-opacity");
  let anchored = false;
  const anchor = (origin?: MotionOrigin | null) => {
    if (anchored) return;
    if (options.path === "rail") { node.style.transformOrigin = "100% 50%"; anchored = true; return; }
    if (origin && origin !== node.ownerDocument.body && origin !== node.ownerDocument.documentElement) {
      const transform = node.style.transform;
      node.style.transform = "none";
      const rect = node.getBoundingClientRect(), trigger = origin.getBoundingClientRect();
      node.style.transformOrigin = `${trigger.left + trigger.width / 2 - rect.left}px ${trigger.top + trigger.height / 2 - rect.top}px`;
      node.style.transform = transform;
      anchored = true;
    } else if (!node.style.transformOrigin) node.style.transformOrigin = "50% 0%";
  };
  if (options.path !== "rail" && node.hasAttribute("popover")) {
    // The top layer has no geometry until showPopover has run.
  } else anchor(options.origin);
  node.dataset.motionSurface = "";
  if (material) node.dataset.motionMaterial = "";
  const paint = (value: number, velocity = 0) => {
    options.onUpdate?.({ value, velocity });
    node.style.opacity = String(Math.max(0, Math.min(1, value)));
    node.style.transform = (reduced || options.path === "fade") ? "none" : options.path === "rail"
      ? `translateX(${(1 - value) * 100}%)`
      : options.path === "sheet" ? `translateX(${(1 - value) * 14}px)`
      : `translateY(${(1 - value) * -6}px) scale(${0.96 + value * 0.04})`;
    if (material) node.style.setProperty("--motion-material-opacity", (reduced || options.path === "fade") ? "0" : String(Math.max(0, 1 - value)));
  };
  const motion = spring(options.initial ?? 0, {
    clock: options.clock, velocity: options.velocity, onUpdate: paint,
    onRest: () => {
      node.style.willChange = saved.willChange;
      delete node.dataset.motionAnimating;
      if (!shown) node.style.visibility = "hidden";
      options.onRest?.(shown);
    },
  });
  const unsubscribe = observePreferences((prefs) => {
    reduced = prefs.reducedMotion;
    if (material) {
      node.dataset.motionSolid = String(prefs.reducedTransparency);
      node.dataset.motionContrast = String(prefs.contrast);
    }
    if (motion.running) motion.to(shown ? 1 : 0, { damping: 1, response: reduced ? 0.08 : 0.35, ...(reduced ? { velocity: 0 } : {}) });
    paint(motion.value, motion.velocity);
  });
  return {
    motion,
    show(next: boolean, origin = options.origin) {
      if (next) anchor(origin);
      shown = next;
      node.style.visibility = "visible";
      node.style.willChange = reduced ? "opacity" : "transform, opacity";
      node.dataset.motionAnimating = "";
      motion.to(next ? 1 : 0, { damping: 1, response: reduced ? 0.08 : 0.35 });
    },
    /** A native dismissal cannot be delayed. Stop presentation without another close callback. */
    finish(next: boolean) {
      shown = next; motion.set(next ? 1 : 0);
      node.style.visibility = next ? "visible" : "hidden";
      node.style.willChange = saved.willChange;
      delete node.dataset.motionAnimating;
    },
    dispose() {
      motion.stop(); unsubscribe();
      if (savedMaterialOpacity) node.style.setProperty("--motion-material-opacity", savedMaterialOpacity);
      else node.style.removeProperty("--motion-material-opacity");
      delete node.dataset.motionMaterial; delete node.dataset.motionAnimating;
      Object.assign(node.style, saved);
      delete node.dataset.motionSurface; delete node.dataset.motionSolid; delete node.dataset.motionContrast;
    },
  };
}
