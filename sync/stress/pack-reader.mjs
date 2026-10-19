// Existing readonly pack parser, mechanically separated from the file writer.
import {unzipSync, strFromU8} from 'fflate';

export const LIMITS = { fileBytes: 64 * 1024 * 1024, entries: 10000, expandedBytes: 64 * 1024 * 1024, markdownBytes: 1024 * 1024 };

export class ActorError extends Error {
  constructor(code, message) { super(message ?? code); this.code = code; }
}

export const safePath = (path) => !!path && !path.includes('\\') && !Array.from(path).some((c) => c.charCodeAt(0) < 32)
  && !path.split('/').some((part) => !part || part === '.' || part === '..') && !/^[A-Za-z]:/.test(path);

// Decompress every entry with bounds; keep order and directory markers. Nothing is interpreted yet.
export function readPack(bytes) {
  if (bytes.byteLength > LIMITS.fileBytes) throw new ActorError('pack-too-large', 'TextPack exceeds the file size limit');
  let expanded = 0; const seen = new Set(); const order = [];
  let files;
  try {
    files = unzipSync(bytes, { filter(entry) {
      const path = entry.name.endsWith('/') ? entry.name.slice(0, -1) : entry.name;
      if (!safePath(path) || seen.has(entry.name)) throw new ActorError('pack-invalid', 'invalid or duplicate ZIP entry');
      seen.add(entry.name); order.push(entry.name);
      if (seen.size > LIMITS.entries || (expanded += entry.originalSize) > LIMITS.expandedBytes) throw new ActorError('pack-too-large', 'expanded TextPack exceeds limits');
      return true;
    } });
  } catch (e) { throw e instanceof ActorError ? e : new ActorError('pack-invalid', 'not a readable ZIP'); }
  const entries = order.map((name) => ({ name, data: files[name] ?? new Uint8Array(0) }));
  return { entries, root: canonicalRoot(entries) };
}

// The canonical document root is the one place where text.md and document.json sit together at the
// archive root or inside exactly one top-level folder. A deeper text.md (for example assets/text.md
// or <bundle>/assets/text.md) is an attachment, never the document.
export function canonicalRoot(entries) {
  const names = new Set(entries.map((e) => e.name));
  const roots = [...names].filter((n) => n === 'text.md' || /^[^/]+\/text\.md$/.test(n)).map((n) => n.slice(0, -'text.md'.length))
    .filter((root) => names.has(`${root}document.json`));
  if (roots.length !== 1) throw new ActorError('pack-root', 'TextPack must contain exactly one canonical text.md and document.json pair');
  return roots[0];
}

export const entryOf = (pack, leaf) => pack.entries.find((e) => e.name === pack.root + leaf);

export function markdownOf(pack) {
  const entry = entryOf(pack, 'text.md');
  if (!entry || entry.data.byteLength > LIMITS.markdownBytes) throw new ActorError('pack-invalid', 'text.md missing or too large');
  return strFromU8(entry.data);
}

// Frontmatter scalar as the projection parser reads it: single line `key: value`, JSON string or bare.
function frontmatterValue(markdown, key) {
  const header = markdown.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)?.[1] ?? '';
  const values = [...header.matchAll(new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, 'gm'))];
  if (values.length === 0) return undefined;
  if (values.length !== 1) return null;
  let value = values[0][1];
  if (value.startsWith('"')) { try { value = JSON.parse(value); } catch { return null; } }
  return typeof value === 'string' ? value : null;
}

// The body exactly as the editor holds it: everything after the closing delimiter and one optional
// blank separator line, matching parseProjectionMarkdown. Without frontmatter the whole file is body.
export function bodyOf(markdown) {
  const text = markdown.replace(/^﻿/, '');
  return text.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n(?:\r?\n)?([\s\S]*)$/)?.[1] ?? text;
}

// Identity lives in text.md (textTextId) and document.json (schema-v1 title).
// CLI-created packs may omit the optional Markdown title; an explicit title must still agree.
// The pack does not record its workspace; that comes from
// the actor config and must equal the coordinator's fixture before anything is written.
export function validateIdentity(pack, config) {
  const markdown = markdownOf(pack);
  const docEntry = entryOf(pack, 'document.json');
  let document;
  try { document = JSON.parse(strFromU8(docEntry.data)); } catch { throw new ActorError('identity', 'document.json is not JSON'); }
  if (!document || document.schemaVersion !== 1 || typeof document.content?.body !== 'string' || typeof document.content?.title !== 'string') {
    throw new ActorError('identity', 'document.json is not a schema-v1 document');
  }
  const id = frontmatterValue(markdown, 'textTextId');
  if (id !== config.itemId) throw new ActorError('identity', 'text.md textTextId does not match the configured item');
  const title = frontmatterValue(markdown, 'title');
  if (title !== undefined) {
    if (title !== config.title) throw new ActorError('identity', 'text.md title does not match the configured acceptance title');
  }
  if (document.content.title !== config.title) throw new ActorError('identity', 'document.json title does not match the configured acceptance title');
  return { markdown, body: bodyOf(markdown) };
}
