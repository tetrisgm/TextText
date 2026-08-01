// Publish one genre-faithful exemplar document per built-in template and
// screenshot every one, light and dark.
//
// This exists because schema validation and even HTML-render gates cannot
// answer the only question that matters for a template catalog: does a recipe
// look like something you would cook from, does a changelog read like
// keepachangelog, does a bookshelf feel like a reading log. The output is a
// directory of PNGs and a contact sheet a human (or the agent driving this)
// actually looks at.
//
//   npx tsx scripts/template-showcase.ts          against http://localhost:3000
//
// Uses the dev-login provider, mints a wsk_ token, drives the real hosted MCP
// endpoint (the same protocol any agent speaks), publishes into the blog
// folder so the PUBLIC reader renders each page, then screenshots with
// Playwright. Nothing here bypasses the product's own surfaces.

import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { EXEMPLARS } from "./template-exemplars";
import { TextTextClient } from "./texttext-live-client";

const ORIGIN = process.env.SHOWCASE_ORIGIN ?? "http://localhost:3000";
const OUT = ".texttext/showcase";

const client = new TextTextClient(ORIGIN);
const tool = (token: string, name: string, args: Record<string, unknown>) =>
  client.tool(token, name, args);

async function main() {
  mkdirSync(OUT, { recursive: true });
  await client.signIn("showcase@texttext.dev", "Showcase");
  const token = await client.mintToken("showcase");
  const workspace = (await tool(token, "get_workspace", {})) as {
    workspace: { handle: string };
  };
  const handle = workspace.workspace.handle;
  console.log(`workspace @${handle}, publishing ${EXEMPLARS.length} exemplars`);

  // Idempotent: a rerun reuses items already published, so a mid-run failure
  // never duplicates the catalog.
  const existing = (await tool(token, "list_items", {
    folder_path: "blog",
    limit: 100,
  })) as { items?: { id: string; slug: string; title: string }[] };
  const byTitle = new Map(
    (existing.items ?? []).map((item) => [item.title, item]),
  );

  const pages: { template: string; slug: string; title: string }[] = [];
  for (const exemplar of EXEMPLARS) {
    const already = byTitle.get(exemplar.title);
    if (already) {
      pages.push({ template: exemplar.template, slug: already.slug, title: exemplar.title });
      console.log(`  reuse ${exemplar.template} -> ${already.slug}`);
      continue;
    }
    const created = (await tool(token, "create_item", {
      folder_path: "blog",
      title: exemplar.title,
      body: exemplar.body,
    })) as { item: { id: string; slug: string } };
    const id = created.item.id;
    await tool(token, "set_item_template", {
      id,
      template_id: exemplar.template,
      template_version: 1,
    });
    if (Object.keys(exemplar.fields).length > 0) {
      await tool(token, "update_item", { id, fields: exemplar.fields });
    }
    await tool(token, "set_item_status", { id, status: "published" });
    pages.push({ template: exemplar.template, slug: created.item.slug, title: exemplar.title });
    console.log(`  ok ${exemplar.template} -> /@${handle}/${created.item.slug}`);
  }

  const browser = await chromium.launch();
  const shots: { template: string; light: string; dark: string }[] = [];
  for (const scheme of ["light", "dark"] as const) {
    const context = await browser.newContext({
      viewport: { width: 1180, height: 1400 },
      colorScheme: scheme,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    for (const entry of pages) {
      await page.goto(`${ORIGIN}/@${handle}/${entry.slug}`, {
        waitUntil: "networkidle",
      });
      const file = `${OUT}/${entry.template.replace("texttext.", "")}-${scheme}.png`;
      await page.screenshot({ path: file, fullPage: true });
      if (scheme === "light") {
        shots.push({ template: entry.template, light: file, dark: file.replace("-light", "-dark") });
      }
    }
    await context.close();
  }
  await browser.close();

  const sheet = `<!doctype html><meta charset="utf-8"><title>Template showcase</title>
<style>body{font:14px -apple-system,sans-serif;background:#111;color:#eee;margin:0;padding:20px}
h2{margin:30px 0 8px}img{width:48%;border:1px solid #333;border-radius:8px;vertical-align:top}
</style>${shots
    .map(
      (s) =>
        `<h2>${s.template}</h2><img src="${s.light.replace(OUT + "/", "")}"><img src="${s.dark.replace(OUT + "/", "")}">`,
    )
    .join("\n")}`;
  writeFileSync(`${OUT}/index.html`, sheet);
  console.log(`\n${shots.length} templates screenshotted -> ${OUT}/index.html`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
