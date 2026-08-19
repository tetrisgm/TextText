// Exercise AI-assisted item-type creation in the running product.
//
//   npm run dev
//   npm run eval:item-type
//
// This is intentionally a browser evaluation, not a source assertion. It
// saves a complete starter type, applies it to a folder, creates a new item,
// edits its generated fields, and watches the item move on the rendered board.

import { chromium, type Page } from "playwright";
import { ITEM_TYPE_STARTERS } from "../src/lib/presentation/item-type-blueprint";

const BASE = process.env.TEXTTEXT_BASE_URL ?? "http://localhost:3000";
const WHO = { email: "item-type-live-aug19@example.com", name: "Item type" };
let failures = 0;

function check(claim: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok    ${claim}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${claim}${detail ? ` (${detail})` : ""}`);
  }
}

async function signIn(page: Page) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(`${BASE}/editor`, { waitUntil: "networkidle" });
    const form = page.locator("form.ac-devsignin");
    await form.waitFor({ timeout: 20_000 }).catch(() => undefined);
    if ((await form.count()) === 0) break;
    await form.locator('input[type="email"]').fill(WHO.email);
    await form
      .locator('input[placeholder="Name (optional)"]')
      .first()
      .fill(WHO.name)
      .catch(() => undefined);
    await form.locator('button[type="submit"]').click();
    await page.waitForTimeout(2500);
    await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    if (!page.url().includes("/signin")) break;
    console.log(`    (sign-in bounced, retry ${attempt})`);
    if (attempt === 3) throw new Error("dev sign-in never took");
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    if ((await page.locator(".workspace-library-header").count()) > 0) return;
  }
  const body = await page.locator("body").innerText().catch(() => "");
  throw new Error(
    `Workspace never loaded (last url ${page.url()}; body ${body.slice(0, 500)})`,
  );
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 } });
  const connectedAgentBlueprint = {
    ...structuredClone(ITEM_TYPE_STARTERS[0]!.blueprint),
    name: "AI reading list",
    description: "A reading list designed by the connected TextText Agent.",
  };
  await context.addInitScript(`(() => {
    const blueprint = ${JSON.stringify(connectedAgentBlueprint)};
    const state = { prompts: [], registeredTools: [] };
    const emit = (detail) => window.dispatchEvent(
      new CustomEvent("texttext:assistant", { detail })
    );
    Object.assign(window, {
      __TEXTTEXT_APP__: true,
      __TEXTTEXT_NATIVE_ITEM_TYPE_EVAL__: state,
      webkit: {
        messageHandlers: {
          textTextApp: {
            postMessage(message) {
              const body = message || {};
              if (body.action === "assistantTools") {
                state.registeredTools = (body.tools || []).map((tool) => tool.name || "");
              } else if (body.action === "assistantStatus") {
                queueMicrotask(() => emit({
                  type: "status",
                  state: "ready",
                  kind: "native-codex",
                  providerLabel: "Codex with ChatGPT",
                  embeddedChatSupported: true
                }));
              } else if (body.action === "assistantTurn") {
                state.prompts.push(body.prompt || "");
                setTimeout(() => emit({
                  type: "tool-call",
                  callId: "item-type-preview",
                  tool: "preview_item_type",
                  arguments: { blueprint_json: JSON.stringify(blueprint) }
                }), 10);
              } else if (
                body.action === "assistantToolResult" &&
                body.callId === "item-type-preview"
              ) {
                setTimeout(() => emit({ type: "turn-completed" }), 10);
              }
            }
          }
        }
      }
    });
  })()`);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("browser page error", error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error("browser console error", message.text());
  });
  const itemTitle = `Launch checklist ${Date.now().toString(36)}`;

  try {
    await signIn(page);
    await page.locator(".workspace-build-type-button").click();
    check(
      "the focused builder opens from Home",
      (await page.getByRole("heading", { name: "What do you want to build?" }).count()) === 1,
    );
    check(
      "complete starters are available without a provider round trip",
      (await page.getByRole("button", { name: /Project board/ }).count()) === 1,
    );

    await page
      .getByPlaceholder(/A reading list with author/)
      .fill("A Medium-like reading list with author, status, and rating");
    await page.getByRole("button", { name: "Build this item type" }).click();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .waitFor({ timeout: 20_000 });
    check(
      "the focused builder uses the connected Codex or ChatGPT agent without an API key",
      (await page
        .getByRole("textbox", { name: "Name", exact: true })
        .inputValue()) ===
        "AI reading list",
    );
    const nativeProof = await page.evaluate(() => {
      const state = (
        window as Window & {
          __TEXTTEXT_NATIVE_ITEM_TYPE_EVAL__?: {
            prompts: string[];
            registeredTools: string[];
          };
        }
      ).__TEXTTEXT_NATIVE_ITEM_TYPE_EVAL__;
      return state ?? { prompts: [], registeredTools: [] };
    });
    check(
      "the native agent receives a preview-only tool and no direct save instruction",
        nativeProof.registeredTools.includes("preview_item_type") &&
        nativeProof.prompts.some(
          (prompt) =>
            prompt.includes("quality review rejects the design") &&
            prompt.includes("call it again") &&
            prompt.includes("Do not call any other tool"),
        ),
    );
    await page.getByRole("button", { name: "Back", exact: true }).click();

    await page.getByRole("button", { name: /Project board/ }).click();
    check(
      "item and folder previews are both present",
      (await page.getByRole("tab", { name: "Item" }).count()) === 1 &&
        (await page.getByRole("tab", { name: "Folder" }).count()) === 1,
    );
    check(
      "the studio exposes reversible history, responsive previews, and quality preflight",
      (await page.getByRole("combobox", { name: "Design version" }).count()) === 1 &&
        (await page.getByRole("group", { name: "Preview device" }).count()) === 1 &&
        (await page.getByRole("combobox", { name: "Preview content" }).count()) === 1 &&
        (await page.locator("details").filter({ hasText: /Ready|suggestion|attention/ }).count()) === 1,
    );
    const nameField = page.getByRole("textbox", { name: "Name", exact: true });
    await nameField.fill("Project tasks revised");
    await nameField.fill("Project tasks");
    await page.getByRole("button", { name: "Compare" }).click();
    check(
      "a refinement can be compared with its prior version",
      (await page.getByText("Before", { exact: true }).count()) === 1 &&
        (await page.getByText("Current", { exact: true }).count()) === 1,
    );
    await page.getByRole("button", { name: "Compare" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    check(
      "undo and redo move between complete designs",
      await page.getByRole("button", { name: "Redo" }).isEnabled(),
    );
    await page.getByRole("button", { name: "Redo" }).click();
    await page.getByRole("combobox", { name: "Preview content" }).selectOption("stress");
    await page.getByRole("button", { name: "Phone" }).click();
    check(
      "stress content can be inspected in a phone frame",
      (await page.getByRole("button", { name: "Phone" }).getAttribute("aria-pressed")) === "true" &&
        (await page.getByRole("combobox", { name: "Preview content" }).inputValue()) === "stress",
    );
    await page.getByRole("combobox", { name: "Preview content" }).selectOption("sample");
    await page.getByRole("button", { name: "Wide" }).click();
    await page.getByRole("combobox", { name: "Use in folder" }).selectOption({ label: "Blog" });
    await page.getByRole("combobox", { name: "Preview content" }).selectOption("folder");
    check(
      "the preview can use canonical documents from the selected folder",
      (await page.getByRole("combobox", { name: "Preview content" }).inputValue()) === "folder",
    );
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("dialog").waitFor({ state: "detached", timeout: 20_000 });

    await page.getByRole("button", { name: "Blog", exact: true }).click();
    const composer = page.getByRole("textbox", { name: "Create an item" });
    await composer.fill(itemTitle);
    await composer.press("Enter");
    await page.getByRole("button", { name: "Look Project tasks" }).waitFor({ timeout: 20_000 });
    check(
      "a new folder item inherits the generated type",
      (await page.getByRole("combobox", { name: "Status" }).count()) === 1 &&
        (await page.getByRole("combobox", { name: "Priority" }).count()) === 1 &&
        (await page.getByRole("textbox", { name: "Due" }).count()) === 1,
    );
    check(
      "internal template fields stay out of the editor",
      (await page.getByRole("textbox", { name: "Type icon" }).count()) === 0,
    );
    await page.locator(".tt-save-state", { hasText: "Saved" }).waitFor({ timeout: 10_000 });
    // Let the initial collaboration catch-up and Strict Mode remount settle.
    // The checks below are about durable field behavior, not startup timing.
    await page.waitForTimeout(1200);

    const statusInput = page.getByRole("combobox", { name: "Status" });
    const peoplePicker = page.locator(".tt-people-picker");
    check(
      "people fields use the workspace-backed picker with a manual fallback",
      (await peoplePicker.count()) === 1 &&
        (await peoplePicker.getByText("Choose people", { exact: true }).count()) === 1 &&
        (await peoplePicker.getByText("Use an ID instead", { exact: true }).count()) === 1,
    );
    await peoplePicker.getByText("Choose people", { exact: true }).click();
    const personOptions = peoplePicker.locator('.tt-people-options [role="option"]');
    check(
      "the people picker offers canonical workspace items",
      (await personOptions.count()) > 0,
    );
    const selectedPerson = await personOptions.first().locator("strong").innerText();
    await personOptions.first().click();
    check(
      "a workspace item becomes a removable person chip",
      (await peoplePicker.getByRole("button", { name: `Remove ${selectedPerson}` }).count()) === 1,
    );
    await page.waitForTimeout(800);
    await page.locator(".tt-save-state", { hasText: "Saved" }).waitFor({ timeout: 10_000 });
    check(
      "a selected workspace person survives materialization",
      (await peoplePicker.getByRole("button", { name: `Remove ${selectedPerson}` }).count()) === 1,
    );
    const hideAssistant = page.getByRole("button", { name: "Hide assistant" });
    if ((await hideAssistant.count()) > 0) await hideAssistant.click();

    await page.screenshot({ path: "/tmp/texttext-advanced-fields-light.png", fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(150);
    if ((await peoplePicker.locator("details.tt-people-picker-menu[open]").count()) === 0) {
      await peoplePicker.locator("details.tt-people-picker-menu > summary").click();
    }
    await page.screenshot({ path: "/tmp/texttext-advanced-fields-dark.png", fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(150);
    await peoplePicker.scrollIntoViewIfNeeded();
    if ((await peoplePicker.locator("details.tt-people-picker-menu[open]").count()) === 0) {
      await peoplePicker.locator("details.tt-people-picker-menu > summary").click();
    }
    const narrowGeometry = await peoplePicker.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const popover = element.querySelector<HTMLElement>(".tt-people-picker-popover")?.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        popoverLeft: popover?.left ?? null,
        popoverRight: popover?.right ?? null,
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    await page.screenshot({ path: "/tmp/texttext-advanced-fields-narrow.png", fullPage: true });
    check(
      "people and workflow controls stay inside a narrow editor without horizontal overflow",
      narrowGeometry.left >= 0 &&
        narrowGeometry.right <= narrowGeometry.viewport &&
        narrowGeometry.popoverLeft !== null &&
        narrowGeometry.popoverLeft >= 0 &&
        narrowGeometry.popoverRight !== null &&
        narrowGeometry.popoverRight <= narrowGeometry.viewport &&
        narrowGeometry.scrollWidth <= narrowGeometry.viewport,
      JSON.stringify(narrowGeometry),
    );
    await page.setViewportSize({ width: 1440, height: 940 });
    await page.emulateMedia({ colorScheme: "light" });

    if ((await statusInput.inputValue()) === "") {
      await statusInput.selectOption({ value: "not-started" });
    }
    await statusInput.selectOption({ label: "Done" });
    const doneOptions = await statusInput.locator("option").allTextContents();
    check(
      "workflow status keeps the current value and offers only valid next states",
      (await statusInput.inputValue()) === "done" &&
        doneOptions.includes("Done") &&
        doneOptions.includes("In progress") &&
        !doneOptions.includes("Not started"),
      doneOptions.join(", "),
    );
    await statusInput.selectOption({ label: "In progress" });
    await page.getByRole("combobox", { name: "Priority" }).selectOption({ label: "High" });
    await page.locator(".tt-save-state", { hasText: "Saved" }).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "Blog", exact: true }).click();
    await page.waitForTimeout(1000);
    const board = page.getByRole("listbox", { name: "Folder board" });
    await board.waitFor({ timeout: 20_000 });
    const boardText = await board.innerText();
    check(
      "the saved folder renders the requested status board",
      ["Not started", "In progress", "Done"].every((label) => boardText.includes(label)),
      boardText.slice(0, 100),
    );
    const progressColumn = page.getByRole("region", { name: "In progress" });
    check(
      "editing a generated property moves the item on the live board",
      (await progressColumn.innerText()).includes(itemTitle),
    );

    const folderOptions = page.getByRole("button", { name: "Folder options for Blog" });
    await folderOptions.hover({ force: true });
    await folderOptions.click({ force: true });
    await page.locator('button:text-is("Change look")').first().click();
    const gallery = page.getByRole("dialog");
    await gallery.waitFor({ timeout: 20_000 });
    check(
      "the generated type is reusable from the look gallery",
      (await gallery.getByText("Project tasks", { exact: true }).count()) > 0,
    );
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? "\npass" : `\n${failures} behavior(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
