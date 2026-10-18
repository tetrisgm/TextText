// Staged accounting only. No coordinator flag until all six real adapters expose
// full validated DocumentSnapshots and durable reopen checks the same fields.
import { canonicalJSON, sha256 } from './identity-observation.mjs';
export const MULTI_FIELD_KEYS = ['body', 'subtitle'];
export function validateMultiFieldEdit(edit) {
  return edit && typeof edit.id === 'string' && edit.id.length <= 64
    && ['mac-app','mac-web','mac-cli','pc-app','pc-web','pc-cli'].includes(edit.role)
    && MULTI_FIELD_KEYS.includes(edit.field) && new RegExp(`^r[0-9]{1,5}-${edit.role}(?:-${edit.field}${edit.field === 'body' ? '|-write[1-8]' : ''})?$`).test(edit.id) && edit.op === 'append'
    && typeof edit.text === 'string' && edit.text.length > 0 && edit.text.length <= 1024;
}
export function documentObservation(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1 || typeof snapshot.content?.title !== 'string'
    || typeof snapshot.content.body !== 'string' || typeof snapshot.content.subtitle !== 'string'
    || snapshot.presentation?.template?.id !== 'texttext.article') throw new Error('Existing article with visible body and subtitle required');
  const canonical = canonicalJSON(snapshot);
  if (Buffer.byteLength(canonical) > 256 * 1024) throw new Error('Full document observation exceeds bound');
  return { snapshot: JSON.parse(canonical), canonical, hash: sha256(canonical) };
}
export function checkMultiFieldAccounting(baseline, observations, edits) {
  const original = documentObservation(baseline);
  if (!Array.isArray(edits) || edits.length > 600 || edits.some(edit=>!validateMultiFieldEdit(edit))
    || new Set(edits.map(edit=>edit.id)).size !== edits.length) throw new Error('Invalid field operation plan');
  for (const field of MULTI_FIELD_KEYS) {
    const texts = edits.filter(edit=>edit.field===field).map(edit=>edit.text);
    if (new Set(texts).size !== texts.length || texts.some(text=>original.snapshot.content[field].includes(text)
      || texts.some(other=>other!==text && other.includes(text)))) throw new Error('Ambiguous field operation markers');
  }
  if (!(observations instanceof Map) || observations.size !== 6
    || ['mac-app','mac-web','mac-cli','pc-app','pc-web','pc-cli'].some(role=>!observations.has(role))) throw new Error('All six full document observations required');
  let finalHash;
  for (const [role, snapshot] of observations) {
    const observed = documentObservation(snapshot), stripped = structuredClone(observed.snapshot);
    for (const field of MULTI_FIELD_KEYS) {
      let value = stripped.content[field];
      for (const edit of edits.filter(edit=>edit.field===field)) {
        if (value.split(edit.text).length !== 2) throw new Error(`Field marker missing or duplicated: ${role}/${edit.id}`);
        value = value.replace(edit.text, '');
      }
      if (value !== original.snapshot.content[field]) throw new Error(`Field baseline lost: ${role}/${field}`);
      stripped.content[field] = value;
    }
    if (canonicalJSON(stripped) !== original.canonical) throw new Error(`Unplanned full document change: ${role}`);
    if (finalHash !== undefined && observed.hash !== finalHash) throw new Error('Full document semantic divergence');
    finalHash = observed.hash;
  }
  return finalHash;
}
