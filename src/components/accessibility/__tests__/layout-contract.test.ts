import { readFileSync } from "node:fs";
import { postcss } from "./css-test-utils";
import { expect, it } from "vitest";

const apple = readFileSync("src/styles/apple.css", "utf8");
function properties(source: string, selector: string) {
  const result: Record<string, string> = {};
  postcss.parse(source).walkRules(rule => {
    if (rule.selector === selector && rule.parent?.type === "root") rule.walkDecls(decl => { result[decl.prop] = decl.value; });
  });
  return result;
}
const tokens = properties(apple, ".applecms");
function length(value: string, root: number): number {
  if (value.startsWith("var(")) return length(tokens[value.slice(4, -1)], root);
  if (value.endsWith("rem")) return parseFloat(value) * root;
  throw new Error(`Non-scaling length ${value}`);
}
for (const size of ["title2", "title3", "headline", "body", "callout", "subheadline", "footnote", "caption1", "caption2"]) {
  it(`${size} typography and line height both scale at 200 percent`, () => {
    for (const prefix of ["--ac-fs-", "--ac-lh-"]) expect(length(tokens[prefix + size], 32)).toBe(length(tokens[prefix + size], 16) * 2);
    expect(length(tokens["--ac-lh-" + size], 32)).toBeGreaterThan(length(tokens["--ac-fs-" + size], 32));
  });
}
it("button and toolbar minimums scale with their text at 200 percent", () => {
  expect(length(tokens["--ac-h-tbtn"], 32)).toBeGreaterThan(length(tokens["--ac-lh-footnote"], 32));
  expect(length(tokens["--ac-h-toolbar"], 32)).toBeGreaterThan(length(tokens["--ac-lh-body"], 32));
  expect(properties(apple, ".ac-toolbar")["height"]).toBe("auto");
  expect(properties(apple, ".ac-toolbar")["flex-wrap"]).toBe("wrap");
});

for (const file of ["ShareDialog", "CommentsDialog", "ParticipantsRow", "ReaderComments", "FolderLookPicker"]) it(`${file} text and spacing contain no fixed-pixel declarations`, () => {
  postcss.parse(readFileSync(`src/components/workspace/${file}.module.css`, "utf8")).walkDecls(decl => {
    if (/^(font|font-size|line-height|gap|padding(?:-.*)?)$/.test(decl.prop)) expect(decl.value, `${file} ${decl.prop}`).not.toMatch(/\dpx/);
  });
});
it("search sheet and sign-in have bounded scrollable layouts", () => {
  expect(properties(apple, ".command-palette")["max-height"]).toBe("calc(100dvh - 2rem)");
  expect(properties(apple, ".command-palette")["overflow-y"]).toBe("auto");
  expect(properties(apple, ".ac-signin")["overflow"]).toBe("auto");
  expect(properties(apple, ".applecms .ac-signin")["align-items"]).toBe("safe center");
});
it("contrast preferences define borders and focus independently of subtle fills", () => {
  const root = postcss.parse(apple), media: Record<string, string> = {};
  root.walkAtRules("media", rule => { media[rule.params] = rule.toString(); });
  expect(media["(prefers-contrast: more)"]).toContain("border: 1px solid currentColor");
  expect(media["(forced-colors: active)"]).toContain("border: 1px solid ButtonText");
  expect(media["(forced-colors: active)"]).toContain("outline-color: Highlight !important");
  const toggle = properties(apple, '.applecms button[aria-pressed="true"]');
  expect(toggle["text-decoration"]).toBe("underline");
  expect(toggle["font-weight"]).toBeUndefined();
  expect(toggle["border-block-end"]).toBeUndefined();
});

it("assistant and inline preview surfaces strengthen their locally scoped borders", () => {
  for (const file of ["AssistantSidebar", "InlineSelectionPreview"]) {
    const root = postcss.parse(readFileSync(`src/components/workspace/assistant/${file}.module.css`, "utf8"));
    let highContrast = "";
    root.walkAtRules("media", rule => { if (rule.params === "(prefers-contrast: more)") highContrast += rule.toString(); });
    expect(highContrast).toContain("--assistant-rail-divider: var(--assistant-rail-primary)");
  }
});

// These are source declaration contracts. Browser scenarios check the resolved
// layout; this parser intentionally does not pretend to implement the cascade.
const editor = readFileSync("src/components/document/UnifiedDocumentEditor.tsx", "utf8");
const editorCss = editor.match(/<style>\{`([\s\S]*?)`\}<\/style>/)?.[1];
if (!editorCss) throw new Error("Missing inline editor stylesheet");
for (const selector of [".tt-person-presence,.tt-agent-avatar", ".tt-agent-avatar svg", ".tt-field-input.is-checkbox", ".tt-person-chip>button", ".tt-person-avatar", ".tt-rows-editor-remove"]) {
  it(`${selector} stays square at 200 percent text`, () => {
    const rule = properties(editorCss, selector);
    expect(length(rule.width, 32)).toBe(length(rule.height, 32));
    expect(length(rule.width, 32)).toBe(length(rule.width, 16) * 2);
  });
}
it("avatar layout tracks and embedded checkbox scale with their controls", () => {
  expect(properties(editorCss, ".tt-person-avatar").flex).toBe("0 0 1.5rem");
  expect(properties(editorCss, ".tt-people-options>button")["grid-template-columns"]).toBe("1.5rem minmax(0,1fr) 1.125rem");
  expect(properties(editorCss, ".tt-field-row.is-embedded>.tt-field-input.is-checkbox").width).toBe("1rem");
});
it("save speech is outside the pill so an empty label can hide it", () => {
  const pill = editor.match(/<div className=\{`tt-save-state[^]*?<\/div>/)?.[0];
  expect(pill).toContain("{saveStateLabel}");
  expect(pill).not.toContain("StatusAnnouncement");
  expect(editorCss).toContain(".tt-save-state:empty{display:none}");
});
it("ordinary focus is scoped to the editor and exempts programmatic containers", () => {
  expect(apple).not.toContain(':root :is(a[href], button, input, textarea, select, summary, [tabindex], [contenteditable="true"]):focus-visible');
  const focus = properties(apple, '.applecms :is(button, input, textarea, select, summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]):focus-visible');
  expect(focus.outline).toBe("2px solid currentColor");
  expect(properties(apple, '.applecms a[href]:focus-visible')["outline-offset"]).toBe("2px");
});
