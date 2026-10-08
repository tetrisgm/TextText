import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {buildLocalVault} from '../../../scripts/build-local-vault.mjs';

const dir = await mkdtemp(path.join(tmpdir(), 'texttext-parent-picker-'));
let browser;
try {
  const root = process.cwd();
  await symlink(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  await writeFile(path.join(dir, 'entry.tsx'), `
import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {FieldInput} from '${root}/src/components/document/FieldInput';
function Test(){const [parents,setParents]=useState(['missing']);window.parents=parents;
return <FieldInput field={{id:'parents',label:'Parents',type:'reference',target:'document',multiple:true,required:false,visibility:'public'}} value={parents} referenceChoices={[{id:'one',label:'Research'},{id:'two',label:'Publishing'}]} onChange={setParents} onOpenReference={id=>window.opened=id}/>;}
createRoot(document.getElementById('root')).render(<Test/>);
`);
  await buildLocalVault({entry:path.join(dir,'entry.tsx'),output:dir});
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.route('https://parent.test/**', route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.goto('https://parent.test/');
  await page.addScriptTag({content:await readFile(path.join(dir,'app.js'),'utf8')});
  await page.getByText('Unavailable item',{exact:true}).waitFor();
  await page.getByText('Add parent',{exact:true}).click();
  await page.getByRole('searchbox',{name:'Find item'}).fill('Res');
  await page.getByRole('button',{name:'Research',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.parents),['missing','one']);
  assert.equal(await page.locator('details[open]').count(),0);
  await page.getByRole('button',{name:'Research',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.opened),'one');
  await page.getByText('Add parent',{exact:true}).click();
  await page.getByRole('searchbox',{name:'Find item'}).press('Escape');
  assert.equal(await page.locator('summary').evaluate(el=>el===document.activeElement),true);
  await page.getByRole('button',{name:'Remove Research',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.parents),['missing']);
  assert.deepEqual(errors,[]);
  console.log('PASS parent picker: stable IDs, preserved unavailable parent, filtered selection, navigation callback, removal and Escape focus.');
} finally {await browser?.close();await rm(dir,{recursive:true,force:true});}
