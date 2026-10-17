import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

// CSS control specimens use the production selectors. This does not claim
// sharing, capture or feed workflow acceptance.
const specimens = [
  ["Capture", '<div class="vault-capture"><form><button type="submit">Save capture</button></form></div>'],
  ["Sharing", '<form class="vault-sharing-invite"><button>Invite</button></form>'],
  ["Image capture", '<div class="vault-image-capture-target"><button>Choose images</button></div>'],
  ["New card", '<form class="vault-note-draft"><button type="submit">Finish</button></form>'],
  ["Feed updates", '<div class="vault-feed-freshness"><button class="vault-feed-new-articles">New articles</button></div>'],
  ["Feed interests", '<button class="vault-feed-continue">Continue with topics</button>'],
  ["Bookmark", '<form class="vault-bookmark-quick-save"><button type="submit">Save link</button></form>'],
];
const output = await mkdtemp(path.join(tmpdir(), "texttext-accent-contrast-"));
const browser = await chromium.launch();
const receipt = [], failures = [];
const luminance = rgb => rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
const channels = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  await page.setContent('<main class="vault-app">' + specimens.map(([name, markup]) => `<section class="fixture-cell"><h2>${name}</h2>${markup}</section>`).join("") + '</main>');
  await page.addStyleTag({ content: await readFile("src/local-vault/style.css", "utf8") });
  await page.addStyleTag({ content: 'body{margin:0}.vault-app{height:auto;min-height:100vh;display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:24px}.fixture-cell h2{font-size:16px}.vault-app .fixture-cell>div,.vault-app .fixture-cell>form{position:static;transform:none;inset:auto;width:100%;min-height:0;margin:0;padding:12px}.fixture-cell button{margin:0!important}' });
  for (const theme of ["light", "dark"]) {
    // Explicit app appearance must also override the opposite host preference.
    await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(output, `${theme}.png`) });
    for (const [index, [name]] of specimens.entries()) {
      const button = page.locator(".fixture-cell").nth(index).getByRole("button");
      for (const state of ["normal", "hover", "focus"]) {
        if (state === "hover") await button.hover();
        else { await page.mouse.move(0, 0); if (state === "focus") await button.focus(); }
        const colors = await button.evaluate(node => { const style = getComputedStyle(node); return { foreground: style.color, background: style.backgroundColor }; });
        const values = Object.values(colors).map(color => luminance(channels(color))).sort((a, b) => b - a);
        const contrast = (values[0] + .05) / (values[1] + .05);
        receipt.push({ name, theme, state, ...colors, contrast });
        if (contrast < 4.5) failures.push(`${name} ${theme} ${state}: ${contrast.toFixed(2)}:1`);
      }
    }
  }
  await writeFile(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(`Accent button CSS specimens, light/dark screenshots and computed normal/hover/focus contrast: ${output}`);
  assert.deepEqual(failures, []);
  console.log("PASS seven shared accent-button styles exceed 4.5:1 in light/dark normal, hover and focus states.");
} finally { await browser.close(); }
