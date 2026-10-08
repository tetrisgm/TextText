import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { shortcutLabel, useShortcutLabel } from "../useShortcutLabel";
import { build } from "esbuild";
import { chromium } from "playwright";

function Label() { const label = useShortcutLabel(); return <kbd>{label("⌘K")}</kbd>; }

describe("shared platform shortcut labels", () => {
  it("formats Mac, Windows and Linux modifiers without changing plain action keys", () => {
    expect(shortcutLabel("⌘K", "MacIntel")).toBe("⌘K");
    expect(shortcutLabel("⌘⇧S", "Win32")).toBe("Ctrl+Shift+S");
    expect(shortcutLabel("⌘ Enter", "Linux x86_64")).toBe("Ctrl+Enter");
    expect(shortcutLabel("N", "Win32")).toBe("N");
    expect(renderToString(<Label />)).toBe("<kbd>Ctrl+K</kbd>");
  });

  it("hydrates the same server markup on Mac and Windows without mismatches", async () => {
    const fixture = await build({ stdin: { contents: `import React from 'react'; import {hydrateRoot} from 'react-dom/client'; import {useShortcutLabel} from './src/components/accessibility/useShortcutLabel'; function App(){const label=useShortcutLabel();return <kbd>{label('⌘K')}</kbd>} hydrateRoot(document.getElementById('root'), <App/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
    const browser = await chromium.launch({ headless: true });
    try {
      for (const [platform, expected] of [["MacIntel", "⌘K"], ["Win32", "Ctrl+K"], ["Linux x86_64", "Ctrl+K"]]) {
        const page = await browser.newPage(); const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
        await page.setContent(`<div id="root">${renderToString(<Label />)}</div>`);
        await page.evaluate(value => Object.defineProperty(navigator, "platform", { value }), platform);
        await page.addScriptTag({ content: fixture.outputFiles[0].text });
        await expect.poll(() => page.locator("kbd").textContent()).toBe(expected);
        expect(errors).toEqual([]);
        await page.close();
      }
    } finally { await browser.close(); }
  });
});
