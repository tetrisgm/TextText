// Test-only entry. Never bundled into the production application.
import '../../src/local-vault/windows-main';
import { vaultRequest, type VaultFile } from '../../src/local-vault/bridge';
import { readDocument, writePayload } from '../../src/local-vault/model';
const delay = (ms: number) => new Promise(resolve=>setTimeout(resolve,ms));
Object.assign(window, { runDesktopSmoke: async () => {
  const checks: string[] = [];
  const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
  for (let i=0;i<100 && !document.querySelector('button');i++) await delay(100);
  assert(document.querySelector('button'),'shared UI mounted');
  const file = await vaultRequest<VaultFile>('create',{title:'Desktop smoke note',body:'initial smoke text',folder:'Notes'});
  assert(file.path.endsWith('.textpack'),'create TextPack');
  const doc = readDocument(file); doc.content.body = 'saved native smoke marker';
  const saved = await vaultRequest<VaultFile>('write',writePayload(file,doc));
  const reopened = await vaultRequest<VaultFile>('read',{path:saved.path});
  assert(readDocument(reopened).content.body.includes('saved native smoke marker'),'save and reopen');
  const result = await vaultRequest('search',{query:'saved native smoke marker'});
  assert(JSON.stringify(result).includes('Desktop smoke note'),'search saved content');
  window.dispatchEvent(new CustomEvent('texttext:vault-changed'));
  for (let i=0;i<50 && !document.body.innerText.includes('Desktop smoke note');i++) await delay(100);
  assert(document.body.innerText.includes('Desktop smoke note'),'note visible in shared UI');
  const waitFor = async (selector: string) => {
    for (let i=0;i<100;i++) { const element=document.querySelector<HTMLElement>(selector); if(element) return element; await delay(100); }
    throw new Error('Missing control: '+selector);
  };
  const openNote = async () => (await waitFor('button[aria-label*="Desktop smoke note"]')).click();
  await openNote();
  (await waitFor('button[aria-label="Edit card"]')).click();
  const editor=await waitFor('[aria-label="Document body"]');
  editor.focus();
  const selection=window.getSelection()!, range=document.createRange();
  range.selectNodeContents(editor); selection.removeAllRanges(); selection.addRange(range);
  assert(document.execCommand('insertText',false,'edited through native desktop UI'),'editor accepts input');
  for(let i=0;i<50;i++) { const current=await vaultRequest<VaultFile>('read',{path:saved.path}); if(readDocument(current).content.body.includes('edited through native desktop UI')) break; await delay(100); }
  assert(readDocument(await vaultRequest<VaultFile>('read',{path:saved.path})).content.body.includes('edited through native desktop UI'),'editor autosave reaches disk');
  (await waitFor('button[aria-label="Back to Notes"]')).click();
  await openNote();
  await waitFor('[aria-label="Note card"]');
  assert(document.querySelector('[aria-label="Note card"]')?.textContent?.includes('edited through native desktop UI'),'reopened editor content rendered');
  return checks;
}});
