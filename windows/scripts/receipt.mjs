import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
async function tree(base, prefix = '', sourceTree = false) {
  const result = [];
  for (const entry of (await readdir(base, { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (sourceTree && ['bin','obj','build','Assets','Runtime','node_modules'].includes(entry.name)) continue;
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink: ${name}`);
    if (entry.isDirectory()) result.push(...await tree(path.join(base,entry.name), name, sourceTree));
    else result.push([name, createHash('sha256').update(await readFile(path.join(base,entry.name))).digest('hex')]);
  }
  return result;
}
async function source() {
  const entries = [];
  for (const dir of ['src','windows','sync']) for (const [name,hash] of await tree(path.join(root,dir), '', dir === 'windows')) entries.push([`${dir}/${name}`,hash]);
  for (const name of ['package.json','package-lock.json','tsconfig.json','scripts/build-local-vault.mjs']) entries.push([name,createHash('sha256').update(await readFile(path.join(root,name))).digest('hex')]);
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}
const [mode, output, expected] = process.argv.slice(2);
if (mode === 'source') console.log(await source());
else if (mode === 'seal') {
  if (process.platform !== 'win32') throw new Error('Windows receipts require native Windows verification.');
  const digest = await source();
  if (digest !== expected) throw new Error('Sources changed during Windows verification. Rebuild.');
  const artifacts = (await tree(output)).filter(([name])=>name !== 'verification.json');
  if (!artifacts.some(([name])=>name === 'TextText.exe')) throw new Error('Desktop executable missing');
  await writeFile(path.join(output,'verification.json'), JSON.stringify({version:1,platform:process.platform,source:digest,checks:['native-core','native-agent','shared-client','typescript','shared-ui-bundle','desktop-publish'],artifacts,created:new Date().toISOString()},null,2));
} else if (mode === 'verify') {
  const receipt = JSON.parse(await readFile(path.join(output,'verification.json'),'utf8'));
  if (receipt.version !== 1 || receipt.platform !== 'win32' || receipt.source !== await source() || !['native-core','native-agent','shared-client','typescript','shared-ui-bundle','desktop-publish'].every(check => receipt.checks?.includes(check))) throw new Error('Windows candidate does not match verified sources. Rebuild.');
  const artifacts=(await tree(output)).filter(([name])=>name !== 'verification.json');
  if (JSON.stringify(artifacts)!==JSON.stringify(receipt.artifacts)) throw new Error('Windows candidate changed after verification. Rebuild.');
  console.log('Windows candidate source and artifact receipt verified.');
} else throw new Error('Expected source, seal, or verify');
