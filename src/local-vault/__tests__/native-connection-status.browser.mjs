import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Actual NativeConnection and AccountMenu rendering; only transport is controlled.
// This is local regression evidence, never installed acceptance.
(async () => {
  const output = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { NativeConnection } from './src/local-vault/NativeConnection';
      import { setVaultTransport } from './src/local-vault/bridge';
      window.calls = [];
      window.connectionReads = [];
      setVaultTransport(async method => {
        window.calls.push(method);
        if (method === 'connection') return await new Promise((resolve, reject) => {
          window.resolveConnection = resolve; window.rejectConnection = reject;
          window.connectionReads.push({resolve,reject});
        });
        if (method === 'accountRead') return {email:null, name:'Fixture account', identities:[], workspaceName:'Fixture'};
        if (method === 'workspacesList') return {currentId:'one',workspaces:[]};
        if (method === 'recovery') throw Error('Recovery action failed');
        throw Error('Unexpected method: ' + method);
      });
      const reactRoot = createRoot(document.getElementById('root'));
      window.switchRoot = root => reactRoot.render(<NativeConnection root={root}/>);
      window.switchRoot('fixture-one');
    ` },
    bundle: true, write: false, outdir: path.join(tmpdir(), 'texttext-native-connection-bundle'), jsx: 'automatic', loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const name of ['late-snapshot', 'late-read-error', 'action-error', 'root-switch', 'scoped-metadata']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://connection.test/**', route => route.fulfill({
        contentType: 'text/html', body: '<div id="root"></div>',
      }));
      await page.goto('https://connection.test');
      await page.addScriptTag({ content: output.outputFiles.find(file => file.path.endsWith('.js')).text });
      await page.waitForFunction(() => typeof window.resolveConnection === 'function');
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('texttext:vault-sync-status', {
        detail: { connected:true, available:true, onlineReady:false, hasConflicts:true },
      })));
      await page.getByRole('button', { name: /Fixture account|TextText account/ }).click();
      await page.getByRole('button', { name: 'View recovery copies' }).waitFor();
      if (name === 'late-snapshot') {
        await page.evaluate(() => window.resolveConnection({ connected:true, available:true, onlineReady:true, hasConflicts:false }));
      } else if (name === 'late-read-error') {
        await page.evaluate(() => window.rejectConnection(Error('Old connection read failed')));
      } else if (name === 'action-error' || name === 'root-switch') {
        await page.getByRole('button', { name: 'View recovery copies' }).click();
        await page.getByRole('alert').filter({ hasText: 'Recovery action failed' }).waitFor();
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('texttext:vault-sync-status', {
          detail: { connected:true, available:true, onlineReady:true, hasConflicts:true },
        })));
        if (name === 'root-switch') {
          await page.evaluate(() => window.switchRoot('fixture-two'));
          await page.waitForFunction(() => window.connectionReads.length === 2);
          await page.evaluate(() => window.connectionReads[0].resolve({
            workspaceId:'one', connected:true, available:true, hasConflicts:true,
          }));
        }
      } else {
        // Native serializers must supply complete, current-workspace metadata.
        // Do not merge an unscoped old snapshot into a newer event.
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('texttext:vault-sync-status', {
          detail: { workspaceId:'one', webURL:'https://texttext.app/vault/one',
            connected:true, available:true, onlineReady:true, hasConflicts:true },
        })));
      }
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
      const passed = name === 'late-snapshot'
        ? await page.getByRole('button', { name: 'View recovery copies' }).count() === 1
        : name === 'late-read-error'
          ? await page.getByRole('alert').count() === 0
          : name === 'action-error'
            ? await page.getByRole('alert').filter({ hasText: 'Recovery action failed' }).count() === 1
            : name === 'root-switch'
              ? await page.getByRole('button', { name:'View recovery copies' }).count() === 0
                && await page.getByRole('alert').count() === 0
              : await page.getByRole('button', { name:'Open workspace on web' }).isEnabled();
      assert.deepEqual(errors, []);
      results.push({ name, passed });
      await page.close();
    }
  } finally { await browser.close(); }
  console.log(JSON.stringify(results));
  assert.ok(results.every(result => result.passed));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
