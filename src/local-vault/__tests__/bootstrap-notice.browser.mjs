import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { chromium } from 'playwright';
// Full production VaultApp rendering with a controlled transport, not installed acceptance.
const message = 'The connection is taking longer than expected.';
(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        {
            const variant = 'current';
            const output = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { VaultApp } from './src/local-vault/VaultApp';
import { setVaultTransport, VaultError } from './src/local-vault/bridge';
window.calls = [];
window.listFail = true;
window.accessFail = false;
window.createFail = false;
setVaultTransport(async (method, params) => { window.calls.push(method); if (method === 'list') {
    if (window.listFail)
        throw new VaultError('${message}', '408');
    return { root: 'vault:one', name: 'Fixture workspace', folders: ['Notes'], items: [], fullAccess: true, canCreateContent: true };
} if (method === 'workspaceAccess') {
    if (window.accessFail)
        throw new VaultError('Permissions timed out', '408');
    return { fullAccess: true, isOwner: true, canEditContent: true, canComment: true, canManageShares: true, grants: [] };
} if (method === 'folderViews' || method === 'templates')
    return { files: [] }; if (method === 'create') {
    if (window.createFail)
        throw new Error('${message}');
    throw Error('Unexpected create');
} return null; });
createRoot(document.getElementById('root')).render(<VaultApp allowFolderPicker={false}/>);
` }, bundle: true, write: false, outdir: path.join(tmpdir(), 'texttext-warning-renderer-bundle'), jsx: 'automatic', loader: { '.css': 'empty', '.jpg': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'production-local-components', setup(b) { for (const [name, file] of [['ParticipantsRow', 'LocalParticipants.tsx'], ['WorkspaceTypeLibrary', 'LocalTemplateLibrary.tsx'], ['CommandLayer', 'LocalKeyboard.ts']])
                            b.onResolve({ filter: new RegExp('(?:^|/)' + name + '$') }, () => ({ path: path.join(process.cwd(), 'src/local-vault', file) })); } }] });
            const p = await browser.newPage();
            const errors = [];
            p.on('pageerror', e => errors.push(e.message));
            await p.route('https://notice.test/**', r => r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
            await p.goto('https://notice.test');
            await p.addScriptTag({ content: output.outputFiles.find(f => f.path.endsWith('.js')).text });
            await p.getByRole('alert').filter({ hasText: message }).waitFor();
            await p.evaluate(() => { window.listFail = false; window.dispatchEvent(new Event('texttext:vault-changed')); });
            await p.locator('.vault-root').filter({ hasText: 'Fixture workspace' }).waitFor();
            await p.waitForFunction(() => window.calls.includes('workspaceAccess'));
            await p.evaluate(async () => { await new Promise(r => setTimeout(r, 0)); });
            const listingCleared = await p.getByRole('alert').count() === 0;
            console.log(JSON.stringify({ variant, case: 'rendered-listing-timeout-clears-on-recovery', passed: listingCleared }));
            assert.equal(listingCleared, true);
            await p.evaluate(() => { window.accessFail = true; window.dispatchEvent(new Event('texttext:vault-sync-status')); });
            await p.getByRole('alert').filter({ hasText: 'Permissions timed out' }).waitFor();
            await p.evaluate(() => { window.accessFail = false; window.dispatchEvent(new Event('texttext:vault-sync-status')); });
            await p.getByRole('alert').waitFor({ state: 'hidden' });
            console.log(JSON.stringify({ variant, case: 'rendered-access-timeout-clears-on-recovery', passed: true }));
            await p.evaluate(() => { window.listFail = true; window.dispatchEvent(new Event('texttext:vault-changed')); });
            await p.getByRole('alert').filter({ hasText: message }).waitFor();
            await p.evaluate(() => window.createFail = true);
            await p.getByRole('button', { name: 'New note', exact: true }).first().click();
            await p.waitForFunction(() => window.calls.includes('create'));
            await p.waitForFunction(() => document.querySelectorAll('[role=alert]').length === 2);
            await p.evaluate(() => { window.listFail = false; window.dispatchEvent(new Event('texttext:vault-changed')); });
            await p.waitForFunction(() => document.querySelectorAll('[role=alert]').length === 1);
            assert.equal(await p.getByRole('alert').textContent(), message);
            console.log(JSON.stringify({ variant, case: 'same-text-real-create-failure-survives-list-recovery', passed: true }));
            assert.deepEqual(errors, []);
            await p.close();
        }
    }
    finally {
        await browser.close();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
