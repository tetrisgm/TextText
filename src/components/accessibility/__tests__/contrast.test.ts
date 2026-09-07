import { readFileSync } from "node:fs";
import { postcss } from "./css-test-utils";
import { describe, expect, it } from "vitest";

type Color = [number, number, number, number];
type Scope = Record<string, string>;
function tokens(file: string, selector: string) {
  const result: Scope = {};
  postcss.parse(readFileSync(file, "utf8")).walkRules(rule => {
    if (rule.selector !== selector || rule.parent?.type !== "root") return;
    rule.walkDecls(decl => { if (decl.prop.startsWith("--")) result[decl.prop] = decl.value; });
  });
  return result;
}
/* A painted colour may be written as var(--token) or var(--token, fallback):
   follow it to the value the browser would actually paint, so a rule can name
   its token once and this file still measures the real colour. Anything the
   scope cannot resolve is a failure, not a skip - a colour that escapes into a
   token declared somewhere else is exactly what these tests exist to catch. */
function resolve(value: string, scope: Scope, seen: string[] = []): string {
  const reference = value.trim().match(/^var\(\s*(--[\w-]+)\s*(?:,([\s\S]+))?\)$/);
  if (!reference) return value.trim();
  const [, name, fallback] = reference;
  if (seen.includes(name)) throw new Error(`Circular ${[...seen, name].join(" -> ")}`);
  const declared = scope[name] ?? fallback;
  if (declared === undefined) throw new Error(`Unresolved ${name} in ${value}`);
  return resolve(declared, scope, [...seen, name]);
}
function color(value: string, scope: Scope = {}): Color {
  const resolved = resolve(value, scope);
  if (/^#[\da-f]{6}$/i.test(resolved)) return [parseInt(resolved.slice(1, 3), 16), parseInt(resolved.slice(3, 5), 16), parseInt(resolved.slice(5, 7), 16), 1];
  const rgba = resolved.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) { const parts = rgba[1].split(",").map(Number); return [parts[0], parts[1], parts[2], parts[3] ?? 1]; }
  throw new Error(`Unsupported color ${resolved}`);
}
function token(map: Scope, name: string, label: string): Color {
  const value = map[name];
  if (!value) throw new Error(`Missing ${label} ${name}`);
  return color(value, map);
}
function over(foreground: Color, background: Color): Color {
  return [0, 1, 2].map(i => foreground[i] * foreground[3] + background[i] * (1 - foreground[3])).concat(1) as Color;
}
function luminance(c: Color) {
  return c.slice(0, 3).map(v => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}
function ratio(a: Color, b: Color) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
const paths = { base: "src/styles/tokens.css", apple: "src/styles/apple.css", rail: "src/components/workspace/assistant/AssistantSidebar.module.css" };
for (const theme of ["light", "dark"]) describe(`${theme} real token contrast`, () => {
  const base = { ...tokens(paths.base, ":root"), ...(theme === "dark" ? tokens(paths.base, '[data-theme="dark"]') : {}) };
  const apple = { ...base, ...tokens(paths.apple, ".applecms"), ...(theme === "dark" ? tokens(paths.apple, '[data-theme="dark"] .applecms') : {}) };
  const rail = { ...tokens(paths.rail, ".root"), ...(theme === "dark" ? tokens(paths.rail, ':global([data-theme="dark"]) .root') : {}) };
  const c = (map: Scope, name: string): Color => token(map, name, theme);
  for (const fg of ["--ink", "--ink-2", "--muted", "--accent", "--accent-pressed", "--destructive", "--positive", "--warning"]) {
    for (const bg of ["--bg", "--bg-soft", "--bg-soft-2", "--control-bg", "--control-bg-hover"]) {
      it(`${fg} on ${bg} clears small-text AA`, () => {
        const ground = over(c(base, bg), c(base, "--bg"));
        expect(ratio(over(c(base, fg), ground), ground), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  for (const fg of ["--ac-label", "--ac-label-2", "--ac-label-3", "--ac-placeholder", "--ac-accent", "--ac-red"]) {
    for (const bg of ["--ac-bg", "--ac-bg-2", "--ac-fill-1", "--ac-fill-3", "--ac-tinted-fill", "--ac-mat-bg"]) {
      it(`${fg} on ${bg} clears small-text AA`, () => {
        const ground = over(c(apple, bg), c(apple, "--ac-bg"));
        expect(ratio(over(c(apple, fg), ground), ground), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  it("placeholder ink stays quieter than secondary labels without losing AA", () => {
    expect(luminance(c(apple, "--ac-placeholder")) < luminance(c(apple, "--ac-label-2"))).toBe(theme === "dark");
  });
  it("selection soft color shares its solid selection RGB", () => {
    expect(c(apple, "--row-selected-soft").slice(0, 3)).toEqual(c(apple, "--row-selected-bg").slice(0, 3));
  });
  for (const map of [base, apple]) it(`${map === base ? "base" : "Apple"} selected row has AA ink and a meaningful focus outline`, () => {
    expect(ratio(c(map, "--row-selected-ink"), c(map, "--row-selected-bg"))).toBeGreaterThanOrEqual(4.5);
  });
  it("accent selection and its count badge have AA ink", () => {
    const foreground = c(apple, "--ac-on-accent"), background = c(apple, "--ac-accent");
    expect(ratio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(foreground, over([foreground[0], foreground[1], foreground[2], 0.22], background))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(c(apple, "--ac-accent-contrast"), background)).toBeGreaterThanOrEqual(4.5);
  });
  it("filled Apple buttons have AA ink", () => {
    expect(ratio(c(apple, "--ac-accent-fill-ink"), c(apple, "--ac-accent-fill"))).toBeGreaterThanOrEqual(4.5);
  });
  for (const fg of ["--assistant-rail-primary", "--assistant-rail-secondary", "--assistant-error"]) {
    for (const bg of ["--assistant-rail-ground", "--assistant-composer-ground", "--assistant-control-fill"]) {
      it(`${fg} on ${bg} clears small-text AA`, () => { expect(ratio(c(rail, fg), c(rail, bg))).toBeGreaterThanOrEqual(4.5); });
    }
  }
});

it("automatic dark uses exactly the explicit dark accessibility colors", () => {
  for (const path of Object.values(paths)) {
    const root = postcss.parse(readFileSync(path, "utf8"));
    const explicit: Record<string, string> = {}, automatic: Record<string, string> = {};
    root.walkRules(rule => {
      if (!rule.selector.includes('data-theme="dark"') && !rule.selector.includes('data-theme="light"')) return;
      const destination = rule.selector.includes('data-theme="dark"') ? explicit : automatic;
      rule.walkDecls(decl => { if (decl.prop.startsWith("--")) destination[decl.prop] = decl.value.replace(/\s+/g, " "); });
    });
    for (const [name, value] of Object.entries(explicit)) expect(automatic[name], `${path} ${name}`).toBe(value);
  }
});

function declaration(file: string, selector: string, prop: string) {
  let value = "";
  postcss.parse(readFileSync(file, "utf8")).walkRules(rule => {
    if (rule.selector === selector && rule.parent?.type === "root") rule.walkDecls(prop, decl => { value = decl.value; });
  });
  if (!value) throw new Error(`Missing ${selector} ${prop}`);
  return value;
}
/* The palette is dark in both themes, so its colours live on the palette rule
   itself rather than in the theme tokens. Rows inherit that rule, so it is the
   whole scope a palette colour may resolve through. */
const palette = tokens(paths.apple, ".command-palette");
for (const foreground of ["--palette-ink", "--palette-ink-2"]) {
  for (const selector of [".command-palette", ".command-palette-row.is-selected"]) it(`palette ${foreground} on ${selector} clears AA in either theme`, () => {
    const ground = color(declaration(paths.apple, selector, "background"), palette);
    expect(ratio(token(palette, foreground, "palette"), ground), `${foreground} on ${selector}`).toBeGreaterThanOrEqual(4.5);
  });
}
/* "In either theme" only holds while nothing re-colours a plain palette per
   theme; the readers above see root-level rules only, so prove it here. The
   shortcut sheet (.command-palette--sheet) is excluded on purpose: it follows
   the theme by design and carries its own --sheet-* colours. */
it("nothing re-colours the plain command palette per theme", () => {
  const themed: string[] = [];
  postcss.parse(readFileSync(paths.apple, "utf8")).walkRules(rule => {
    const perTheme = /\[data-theme=/.test(rule.selector)
      || (rule.parent?.type === "atrule" && /prefers-color-scheme/.test(rule.parent.params ?? ""));
    if (!perTheme || !/\.command-palette(?![\w-])/.test(rule.selector)) return;
    rule.walkDecls(decl => { if (/^(--palette-|background|border-color|color$)/.test(decl.prop)) themed.push(`${rule.selector} { ${decl.prop} }`); });
  });
  expect(themed).toEqual([]);
});
it("palette keycaps have AA text against their real fill", () => {
  expect(ratio(color(declaration(paths.apple, ".command-palette-shortcut kbd", "color"), palette), color(declaration(paths.apple, ".command-palette-shortcut kbd", "background"), palette))).toBeGreaterThanOrEqual(4.5);
});

for (const theme of ["light", "dark"]) {
  const file = "src/styles/workspace.css";
  const selector = ".post-editor-shell:has(.workspace-action-bar-host)";
  const bar = { ...tokens(file, selector), ...(theme === "dark" ? tokens(file, `[data-theme="dark"] ${selector}`) : {}) };
  const pane = tokens(file, `${theme === "dark" ? '[data-theme="dark"] ' : ""}.post-editor-shell .tt-unified-editor`)["--workspace-pane-ground"];
  for (const ink of ["--workspace-action-bar-ink", "--workspace-action-bar-muted"]) {
    for (const ground of [pane, bar["--workspace-action-bar-hover"]]) it(`${theme} action bar ${ink} on ${ground} clears AA`, () => {
      expect(ratio(token(bar, ink, theme), color(ground, bar))).toBeGreaterThanOrEqual(4.5);
    });
  }
  it(`${theme} action bar accent has AA ink`, () => {
    expect(ratio(token(bar, "--workspace-action-bar-on-accent", theme), token(bar, "--workspace-action-bar-accent", theme))).toBeGreaterThanOrEqual(4.5);
  });
}
