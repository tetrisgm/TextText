// Light, dark, or whatever the system says.
//
// tokens.css already defines the complete dark palette twice - once behind
// [data-theme="dark"] for an explicit choice, once behind a
// prefers-color-scheme query guarded by :not([data-theme="light"]) so the OS
// only wins when no choice has been made. So the whole of this file is a
// preference and a single attribute on <html>; no colour lives here.

export type Appearance = "light" | "dark" | "system";

export const APPEARANCE_STORAGE_KEY = "texttext:appearance";
export const APPEARANCE_CHANGED_EVENT = "texttext:appearance-changed";

export function isAppearance(value: unknown): value is Appearance {
  return value === "light" || value === "dark" || value === "system";
}

/** Put the choice on the document. "system" removes the attribute, which is
 * what hands the decision back to prefers-color-scheme. */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  if (appearance === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", appearance);
}

export function readAppearance(): Appearance {
  try {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return isAppearance(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function writeAppearance(appearance: Appearance): void {
  try {
    if (appearance === "system") {
      window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance);
    }
  } catch {
    /* private mode: the choice lasts for this session only */
  }
  applyAppearance(appearance);
  window.dispatchEvent(new Event(APPEARANCE_CHANGED_EVENT));
}

/** Light -> dark -> system -> light, which is the order a person expects
 * when a single key cycles a three-state setting. */
export function nextAppearance(current: Appearance): Appearance {
  if (current === "light") return "dark";
  if (current === "dark") return "system";
  return "light";
}

export function appearanceLabel(appearance: Appearance): string {
  if (appearance === "light") return "Light";
  if (appearance === "dark") return "Dark";
  return "System";
}

/**
 * Runs before first paint, from the document head. Inlined as a string
 * because it has to execute ahead of React: reading the preference after
 * hydration means a light frame in front of someone who chose dark.
 */
export const APPEARANCE_BOOT_SCRIPT = `(function(){try{var v=localStorage.getItem(${JSON.stringify(
  APPEARANCE_STORAGE_KEY,
)});if(v==="light"||v==="dark"){document.documentElement.setAttribute("data-theme",v);}}catch(e){}})();`;
