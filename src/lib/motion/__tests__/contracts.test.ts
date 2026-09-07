import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const read = (path: string) => readFileSync(`src/${path}`, "utf8");
it("makes material solid and adds a defined border through existing light/dark tokens", () => {
  const css = read("lib/motion/motion.css"), apple = read("styles/apple.css");
  expect(css).toContain("@media (prefers-reduced-transparency: reduce)");
  expect(css).toContain("@media (prefers-contrast: more)");
  expect(css).toContain("backdrop-filter: none !important");
  expect(css).toContain("outline: 1px solid var(--motion-border");
  expect(css).toContain("var(--motion-solid-ground, var(--ac-bg");
  expect(css).toContain("--motion-solid-ground: var(--palette-ground)");
  expect(css).toContain("--motion-solid-ground: var(--sheet-bg)");
  expect(apple).toContain("--ac-bg: #fcfcfd"); expect(apple).toContain("--ac-bg: #2c2d31");
  expect(apple).toContain("--sheet-bg: #fafcfe"); expect(apple).toContain("--sheet-bg: #1a191c");
  for (const path of ["components/document/TemplateGallery.module.css", "components/workspace/assistant/InlineSelectionPreview.module.css", "components/workspace/assistant/AssistantSidebar.module.css"]) {
    expect(read(path)).toContain("--motion-solid-ground:"); expect(read(path)).toContain("--motion-border:");
  }
});
it("replaces the old palette keyframes and rail timing with spring integration", () => {
  const apple = read("styles/apple.css"), rail = read("components/workspace/assistant/AssistantSidebar.module.css");
  expect(apple).not.toMatch(/animation: command-(palette|backdrop|sheet)-in/);
  expect(rail).not.toContain("transform 180ms ease");
});
