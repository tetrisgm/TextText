// Explicit physical-PC acceptance. Runs visible Edge against Oracle with the
// existing TextText account. Credentials stay in memory, never in receipts.
import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const [planFile, receipts] = process.argv.slice(2);
if (process.platform !== 'win32' || !planFile || !receipts) throw Error('Run on the physical PC with a plan and new receipt directory.');
const plan = JSON.parse(await readFile(planFile, 'utf8'));
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const start = Date.parse(plan.StartUtc);
if (!uuid.test(plan.WorkspaceId) || !uuid.test(plan.ItemId) ||
    typeof plan.Title !== 'string' || !plan.Title.startsWith('Six-client acceptance ') ||
    !/^[a-zA-Z0-9_-]{1,40}$/.test(plan.RunId) || !Number.isFinite(start) || start <= Date.now() || start > Date.now() + 300000 ||
    !Number.isInteger(plan.Rounds) || plan.Rounds < 1 || plan.Rounds > 32 ||
    !Number.isInteger(plan.IntervalMs) || plan.IntervalMs < 500 || plan.IntervalMs > 10000 ||
    !Number.isInteger(plan.ObserveSeconds) || plan.ObserveSeconds < 5 || plan.ObserveSeconds > 120 ||
    !Array.isArray(plan.ExpectedMarkers) || plan.ExpectedMarkers.length > 256 ||
    plan.ExpectedMarkers.some(x => typeof x !== 'string' || !x.length || x.length > 100)) throw Error('Invalid bounded browser plan.');
await mkdir(receipts); // Refuse to overwrite a prior run.
const record = value => appendFile(path.join(receipts, 'events.jsonl'), JSON.stringify({ utc: new Date().toISOString(), ...value }) + '\n');
const profile = path.join(process.env.LOCALAPPDATA, 'TextTextAcceptance', 'edge-' + randomUUID());
let context;
let stage = "account";
try {
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $p=Join-Path $env:LOCALAPPDATA 'TextText/account.dpapi'; $v=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($p),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Text.Encoding]::UTF8.GetString($v))`;
  const account = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }));
  if (account.WorkspaceId !== plan.WorkspaceId || typeof account.Token !== 'string') throw Error('Saved account does not match the test workspace.');
  stage = 'launch';
  context = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: false, viewport: { width: 1280, height: 900 } });
  const origin = 'https://texttext.app';
  const destination = `/vault/${plan.WorkspaceId}?item=${plan.ItemId}`;
  stage = 'sign-in';
  const auth = await context.request.post(origin + '/api/app/session?next=' + encodeURIComponent(destination), {
    headers: { Authorization: 'Bearer ' + account.Token, 'x-texttext-app': '1' }, maxRedirects: 0,
  });
  account.Token = '';
  if (auth.status() !== 303) throw Error('Existing app account could not establish the browser session.');
  const page = context.pages()[0] ?? await context.newPage();
  stage = 'open-editor';
  await page.goto(origin + destination, { waitUntil: 'domcontentloaded' });
  const heading = page.locator('.vault-context-location h2');
  await page.waitForFunction(title => document.querySelector('.vault-context-location h2')?.textContent?.trim() === title, plan.Title, { timeout: 45000 });
  const body = page.getByRole('textbox', { name: 'Document body', exact: true });
  if (!await body.isVisible()) await page.getByRole('button', { name: 'Edit card', exact: true }).click();
  await body.waitFor({ state: 'visible', timeout: 30000 });
  if (Date.now() >= start) throw Error('Browser missed the coordinated start.');
  await page.evaluate(() => {
    const editor = document.querySelector('[aria-label="Document body"]');
    window.texttextAcceptanceContinuity = { removed: false };
    const observer = new MutationObserver(() => { if (!editor.isConnected) window.texttextAcceptanceContinuity.removed = true; });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await record({ kind: 'ready', itemId: plan.ItemId, runId: plan.RunId, browser: 'visible Microsoft Edge', profile, mockedTransport: false });
  await new Promise(resolve => setTimeout(resolve, start - Date.now()));
  stage = 'typing';
  const own = [];
  for (let i = 0; i < plan.Rounds; i++) {
    if ((await heading.textContent())?.trim() !== plan.Title) throw Error('Browser navigated away from the test item.');
    const marker = `[pc-web:${plan.RunId}:${String(i).padStart(2, '0')}]`;
    own.push(marker);
    await body.focus(); await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' ' + marker);
    await record({ kind: 'input', marker });
    await new Promise(resolve => setTimeout(resolve, plan.IntervalMs));
  }
  stage = 'convergence';
  const markers = [...new Set([...plan.ExpectedMarkers, ...own])];
  await page.waitForFunction(expected => {
    const text = document.querySelector('[aria-label="Document body"]')?.textContent ?? '';
    return expected.every(marker => text.split(marker).length === 2);
  }, markers, { timeout: plan.ObserveSeconds * 1000 });
  const text = await body.textContent();
  if (await page.evaluate(() => window.texttextAcceptanceContinuity.removed)) throw Error('The original browser editor was removed.');
  await page.screenshot({ path: path.join(receipts, 'editor.png') });
  await record({ kind: 'editor-continuity', continuous: true, bodySha256: createHash('sha256').update(text).digest('hex'), markers });
  // Finish uses the production save path. Journals remain in the dedicated
  // browser profile if saving fails; no test cleanup deletes that profile.
  stage = 'save';
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await body.waitFor({ state: 'hidden', timeout: 30000 });
  await writeFile(path.join(receipts, 'result.json'), JSON.stringify({ ok: true, itemId: plan.ItemId, runId: plan.RunId }));
} catch {
  await record({ kind: 'failure', stage, message: 'Browser acceptance failed. Dedicated profile and saved journals preserved.', profile });
  await writeFile(path.join(receipts, 'result.json'), JSON.stringify({ ok: false }));
  process.exitCode = 1;
} finally { await context?.close(); }
