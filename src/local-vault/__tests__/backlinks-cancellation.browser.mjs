import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const result = await build({
  stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { VaultCardBacklinks } from './src/local-vault/VaultCardBacklinks';
    import { setVaultTransport } from './src/local-vault/bridge';
    window.pending = []; window.calls = [];
    setVaultTransport((method, params) => new Promise((resolve, reject) => {
      window.calls.push({ method, params }); window.pending.push({ method, resolve, reject });
    }));
    const root = createRoot(document.getElementById('root'));
    window.unmount = () => root.unmount();
    root.render(<VaultCardBacklinks itemId="target" onOpen={() => {}} />);
  ` },
  bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
});
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://backlinks.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto('https://backlinks.test/');
  await page.addScriptTag({ content: result.outputFiles[0].text });
  const open = () => page.getByRole('button', { name: 'Linked from' }).click();
  const close = () => page.getByRole('button', { name: 'Hide links' }).click();
  await open(); await close(); await open();
  await page.evaluate(() => window.pending[1].resolve({ items: [], truncated: false }));
  await page.getByText('No cards link here yet.', { exact: true }).waitFor();
  await page.evaluate(() => window.pending[0].reject(new Error('Superseded failure')));
  await page.evaluate(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await page.waitForFunction(() => !document.body.textContent.includes('Finding linked cards'));
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'read').length), 0);
  await close(); await open();
  await page.evaluate(() => window.pending[2].resolve({ items: Array.from({ length: 8 }, (_, i) => ({ path: 'Notes/Source' + i + '.textpack', title: 'Source' + i })) }));
  await page.waitForFunction(() => window.calls.filter(call => call.method === 'read').length === 4);
  await close(); await open();
  await page.evaluate(() => window.pending[7].resolve({ items: [], truncated: false }));
  await page.getByText('No cards link here yet.', { exact: true }).waitFor();
  await page.evaluate(() => {
    for (const pending of window.pending.slice(3, 7)) pending.resolve({ path: 'Notes/Stale.textpack', markdown: 'See [Target](<#texttext-card=target>).', documentJSON: JSON.stringify({ content: { title: 'Stale result' } }) });
  });
  // A microtask barrier drains the settled old batch before checking its visible result.
  await page.evaluate(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.equal(await page.getByText('Stale result', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'read').length), 4);
  await close(); await open();
  await page.evaluate(() => window.unmount());
  await page.evaluate(() => window.pending[8].resolve({ items: [{ path: 'Notes/Late.textpack', title: 'Late' }] }));
  await page.evaluate(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'read').length), 4);
  assert.deepEqual(errors, []);
  console.log('PASS superseded backlink failures/results cannot overwrite reopened panel; closed/unmounted scans stop after their current batch');
} finally { await browser.close(); }
