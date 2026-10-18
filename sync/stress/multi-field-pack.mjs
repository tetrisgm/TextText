// Ordinary external projection writer, staged until complete real actor support.
// Deliberately leaves document.json/projection baseline untouched so production
// reconciliation must detect and merge the authored Markdown field change.
import { zipSync, strToU8 } from 'fflate';
import { readPack, validateIdentity, markdownOf, appendToPack } from './file-adapter.mjs';
export function appendFieldToPack(bytes, config, field, text) {
  if (typeof text !== 'string' || !text || text.length > 1024 || /[\r\n]/.test(text)) throw new Error('Bounded field text required');
  if (field === 'body') return appendToPack(bytes, config, text);
  if (field !== 'subtitle') throw new Error('Unsupported authored field');
  const pack = readPack(bytes); validateIdentity(pack, config);
  const markdown = markdownOf(pack);
  const match = markdown.match(/^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))([\s\S]*)$/);
  if (!match) throw new Error('Canonical field projection header required');
  const lines = match[2].split(/\r?\n/), indices = lines.flatMap((line,index)=>/^excerpt:/.test(line)?[index]:[]);
  if (indices.length !== 1) throw new Error('One existing excerpt projection required');
  let prior;
  try { prior=JSON.parse(lines[indices[0]].slice('excerpt:'.length).trim()); } catch { throw new Error('Existing excerpt must be a canonical JSON string'); }
  if (typeof prior !== 'string' || prior.includes(text)) throw new Error('Invalid existing field or repeated marker');
  lines[indices[0]] = 'excerpt: ' + JSON.stringify(prior+text);
  const separator=match[1].includes('\r\n')?'\r\n':'\n';
  const next=strToU8(match[1]+lines.join(separator)+match[3]+match[4]);
  const entries={};
  for(const entry of pack.entries) entries[entry.name]=[entry.name===pack.root+'text.md'?next:entry.data,{level:0,mtime:new Date(1980,0,1)}];
  return zipSync(entries,{mtime:new Date(1980,0,1)});
}
