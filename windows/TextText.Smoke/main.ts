// Test-only entry. Never bundled into the production application.
import '../../src/local-vault/windows-main';
import { BUILTIN_TEMPLATES } from '../../src/lib/presentation/templates';
import { vaultRequest, VaultError, type VaultFile, type VaultListing } from '../../src/local-vault/bridge';
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
  const nativeOpen=(window as unknown as {texttextOpenFile:(path:string)=>Promise<string>}).texttextOpenFile;
  assert(await nativeOpen(saved.path)==='opened','acknowledged native file activation opens existing note');
  assert(readDocument(await vaultRequest<VaultFile>('read',{path:saved.path})).content.body.includes('edited through native desktop UI'),'native file activation preserves saved editor content');

  // Creation uses the shipped controls. Subsequent save/reopen assertions use
  // the shared workspace commands and the real native file bridge, not a mock
  // editor. The note check above separately exercises actual editor typing.
  const buttonNamed = async (name: string, scope: ParentNode = document) => {
    for (let attempt=0;attempt<80;attempt++) { const button=[...scope.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent?.trim()===name&&!item.disabled);if(button)return button;await delay(100); }
    throw new Error('Missing enabled button: '+name+'; available: '+[...scope.querySelectorAll<HTMLButtonElement>('button')].filter(item=>item.getClientRects().length).map(item=>item.textContent?.trim()).join(', '));
  };
  const setInput = (input: HTMLInputElement,value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  };
  for(const kind of ['article','bookmark','gallery','talk']) {
    const template=BUILTIN_TEMPLATES.find(item=>item.id===`texttext.${kind}`)!;
    const before=new Set((await vaultRequest<VaultListing>('list')).items.map(item=>item.path));
    try {
    // The shipped creation menu belongs to the overview, not an open item.
    (await waitFor('button.vault-home-button')).click();
    await buttonNamed('New from template');
    const more=await waitFor('summary[aria-label="More actions"]');
    if(!more.closest('details')?.open)more.click();
    (await buttonNamed('New from template')).click();
    (await waitFor(`[role="dialog"][aria-label="New from template"] button[aria-label="${CSS.escape(template.name)}"]`)).click();
    if(kind==='bookmark') {
      setInput(await waitFor('input[aria-label="Web address"]') as HTMLInputElement,'https://example.invalid/isolated-native-smoke');
      setInput(await waitFor('input[aria-label="Capture title"]') as HTMLInputElement,'Desktop bookmark smoke');
      (await buttonNamed('Save bookmark',await waitFor('[role="dialog"][aria-label="Save bookmark"]'))).click();
    }
    if(kind==='gallery') {
      await waitFor('[role="dialog"][aria-label="Add images"]');
      const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;const drawing=canvas.getContext('2d')!;drawing.fillStyle='#37a4f2';drawing.fillRect(0,0,16,16);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('PNG fixture failed')),'image/png'));
      const transfer=new DataTransfer();transfer.items.add(new File([blob],'Desktop gallery smoke.png',{type:'image/png'}));
      const input=await waitFor('input[aria-label="Choose images"]') as HTMLInputElement;input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    }
    let created: VaultFile|undefined;
    for(let attempt=0;attempt<80&&!created;attempt++) {
      const listing=await vaultRequest<VaultListing>('list');
      for(const candidate of listing.items.filter(item=>!before.has(item.path))) {const candidateFile=await vaultRequest<VaultFile>('read',{path:candidate.path});if(readDocument(candidateFile).presentation.template.id===template.id)created=candidateFile;}
      if(!created)await delay(100);
    }
    assert(created,`${kind}: template creation controls write correct TextPack`);
    const flush=(window as unknown as {texttextFlushForSignOut?:()=>Promise<boolean>}).texttextFlushForSignOut;
    assert(!flush||await flush(),`${kind}: creation editor flushes successfully`);
    let fresh=await vaultRequest<VaultFile>('read',{path:created!.path});
    let snapshot=readDocument(fresh);snapshot.content.title=`Desktop ${kind} persisted`;snapshot.content.body=`Native ${kind} saved marker`;
    const imageAssets=fresh.assets?.map(asset=>({filename:asset.filename,data:asset.data}))??[];
    let changed: VaultFile|undefined;
    for(let attempt=0;attempt<3;attempt++) {
      snapshot=readDocument(fresh);snapshot.content.title=`Desktop ${kind} persisted`;snapshot.content.body=`Native ${kind} saved marker`;
      try {changed=await vaultRequest<VaultFile>('write',writePayload(fresh,snapshot));break;}
      catch(error) {
        // Capture enrichment may finish after the creation flush. This direct
        // file writer must rebase its two intended fields on the latest file,
        // just as the editor does, while retaining newly captured metadata.
        if(!(error instanceof VaultError)||error.code!=='conflict'||attempt===2)throw error;
        fresh=await vaultRequest<VaultFile>('read',{path:created!.path});
        checks.push(`${kind}: rebased direct write after concurrent capture`);
      }
    }
    assert(changed,`${kind}: conditional write completed`);
    const again=await vaultRequest<VaultFile>('read',{path:changed!.path});
    assert(readDocument(again).presentation.template.id===template.id&&readDocument(again).content.body===snapshot.content.body,`${kind}: shared edit saves and reopens with template intact`);
    if(kind==='gallery') {
      assert(imageAssets.length>0&&imageAssets.every(asset=>again.assets?.some(saved=>saved.filename===asset.filename&&saved.data===asset.data)),'gallery: native image attachment survives edit and reopen byte-for-byte');
      const asset=again.assets![0];const image=new Image();await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('Reopened attachment cannot decode'));image.src=`data:${asset.contentType};base64,${asset.data}`;});
      assert(image.naturalWidth===16&&image.naturalHeight===16,'gallery: reopened native image decodes with original dimensions');
    }
    window.dispatchEvent(new CustomEvent('texttext:vault-changed'));
    // Open the saved item through the application's normal file-open event.
    window.dispatchEvent(new CustomEvent('texttext:vault-open',{detail:{path:again.path}}));
    for(let attempt=0;attempt<50&&!document.body.innerText.includes(snapshot.content.title);attempt++)await delay(100);
    assert(document.body.innerText.includes(snapshot.content.title),`${kind}: saved item opens in shared desktop UI`);
    } catch(error) { throw new Error(`${kind} template workflow: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return checks;
}});
