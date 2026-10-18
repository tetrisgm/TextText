// Finite driver planning only. Existing actors execute the normal edit commands.
import { canonicalJSON, sha256 } from './identity-observation.mjs';
import { documentObservation, validateMultiFieldEdit } from './multi-field.mjs';
const ROLES = ['mac-app', 'mac-web', 'mac-cli', 'pc-app', 'pc-web', 'pc-cli'];
const KINDS = ['plain', 'cli-writes', 'typing', 'fields', 'history'];
export const MIXED_LIMITS = Object.freeze({
  rounds: 100,
  semanticAdditions: 1200,
  driverActions: 1400,
  bodyBytes: 64 * 1024,
  documentBytes: 256 * 1024
});
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export function validateMixedSchedule(value) {
  if (!value ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'rounds,version' ||
      value.version !== 1 ||
      !Array.isArray(value.rounds) ||
      value.rounds.length < 1 ||
      value.rounds.length > MIXED_LIMITS.rounds) throw Error('mixedSchedule requires version1 and1..100 round descriptors');
  const rounds = value.rounds.map(round => {
    if (!round || Array.isArray(round) || Object.keys(round).join(',') !== 'kind' || !KINDS.includes(round.kind)) throw Error('Unknown mixed schedule descriptor');
    return {
      kind: round.kind
    };
  });
  return freeze({
    version: 1,
    rounds
  });
}
export function fieldOperations(rounds) {
  return rounds.flatMap(round => round.edits.flatMap(edit => edit.fieldEdits ?? (edit.inputSequence ? edit.inputSequence.chunks.map((text, index) => ({
    role: edit.role,
    id: edit.id + '-input' + (index + 1),
    op: 'append',
    field: 'body',
    text
  })) : edit.fileWriteSequence ? edit.fileWriteSequence.chunks.map((text, index) => ({
    role: edit.role,
    id: edit.id + '-write' + (index + 1),
    op: 'append',
    field: 'body',
    text
  })) : [{
    role: edit.role,
    id: edit.id,
    op: 'append',
    field: 'body',
    text: edit.text
  }])));
}
function counts(rounds) {
  const operations = fieldOperations(rounds);
  if (operations.some(edit => !validateMultiFieldEdit(edit)) ||
      new Set(operations.map(edit => edit.id)).size !== operations.length) throw Error('Invalid immutable mixed field plan');
  const edits = rounds.flatMap(round => round.edits),
    historyEditors = edits.filter(edit => edit.undoRedo).length;
  return {
    semanticAdditions: operations.length,
    driverActions: operations.length + historyEditors * 2,
    cliPackWrites: edits.filter(edit => edit.role.endsWith('-cli')).reduce((sum, edit) => sum + (edit.fileWriteSequence?.chunks.length ?? 1), 0),
    historyStages: historyEditors * 3
  };
}
export function createMixedSchedule(value, seed, basePlan) {
  const spec = validateMixedSchedule(value);
  if (!Number.isInteger(seed) || !Array.isArray(basePlan) || basePlan.length !== spec.rounds.length) throw Error('Mixed plan seed or base length invalid');
  let fileOrdinal = 0;
  const rounds = basePlan.map((base, index) => {
    const round = index + 1,
      kind = spec.rounds[index].kind;
    if (base.round !== round || !Array.isArray(base.edits) || base.edits.length !== ROLES.length) throw Error('Mixed base round invalid');
    const fileRole = kind === 'cli-writes' ? fileOrdinal++ % 2 ? 'pc-cli' : 'mac-cli' : null;
    const mode = Math.floor((fileOrdinal - 1) / 2) % 2 === 0 ? 'atomic' : 'in-place';
    const edits = base.edits.map((source, i) => {
      if (Object.keys(source).sort().join(',') !== 'id,op,role,text' ||
          source.role !== ROLES[i] ||
          source.id !== `r${round}-${source.role}` ||
          source.op !== 'append' ||
          typeof source.text !== 'string' ||
          !source.text ||
          source.text.length > 1024) throw Error('Mixed base edit invalid');
      const edit = {
        ...source
      };
      if (kind === 'cli-writes' && edit.role === fileRole) {
        const chunks = [`⟦${edit.role}:r${round}:write1⟧`, edit.text];
        edit.fileWriteSequence = {
          mode,
          chunks,
          intervalMs: 25
        };
        edit.text = chunks.join('');
      } else if (kind === 'typing' && !edit.role.endsWith('-cli')) {
        const chunks = [1, 2, 3].map(n => `⟦${edit.role}:${round}:${n}:café🌿⟧`).concat(edit.text);
        edit.inputSequence = {
          chunks,
          intervalMs: 50
        };
        edit.text = chunks.join('');
      } else if (kind === 'fields') {
        edit.fieldEdits = ['body', 'subtitle'].map(field => ({
          role: edit.role,
          id: edit.id + '-' + field,
          op: 'append',
          field,
          text: field === 'body' ? edit.text : `⟦${edit.role}:r${round}:subtitle⟧`
        }));
      } else if (kind === 'history' && !edit.role.endsWith('-cli')) edit.undoRedo = true;
      return edit;
    });
    const planned = {
      round,
      kind,
      edits
    };
    planned.counts = counts([planned]);
    return planned;
  });
  const totals = counts(rounds);
  if (totals.semanticAdditions > MIXED_LIMITS.semanticAdditions || totals.driverActions > MIXED_LIMITS.driverActions) throw Error('Mixed schedule exceeds finite operation budget');
  const payload = {
    version: 1,
    seed,
    spec,
    rounds,
    totals
  };
  return freeze({
    ...payload,
    sha256: sha256(canonicalJSON(payload))
  });
}
export function preflightMixedDocument(plan, baseline, {
  assetHashes = {}
} = {}) {
  const projected = structuredClone(documentObservation(baseline).snapshot);
  const operations = fieldOperations(plan.rounds);
  for (const field of ['body', 'subtitle']) {
    const texts = operations.filter(edit => edit.field === field).map(edit => edit.text);
    if (new Set(texts).size !== texts.length ||
        texts.some(text => projected.content[field].includes(text) ||
        texts.some(other => other !== text &&
        other.includes(text)))) throw Error('Mixed planned marker already present or ambiguous');
  }
  for (const edit of operations) projected.content[edit.field] += edit.text;
  const bodyBytes = Buffer.byteLength(projected.content.body),
    documentBytes = Buffer.byteLength(canonicalJSON(projected));
  if (bodyBytes > MIXED_LIMITS.bodyBytes) throw Error('Mixed projected body exceeds finite byte bound');
  if (documentBytes > MIXED_LIMITS.documentBytes) throw Error('Mixed projected document exceeds finite byte bound');
  const editIds = plan.rounds.flatMap(round => round.edits.map(edit => edit.id));
  const inputLineBytes = Buffer.byteLength(JSON.stringify({
    type: 'observe',
    round: plan.rounds.length,
    expectedEditIds: editIds,
    expectedAssetPaths: Object.keys(assetHashes),
    documentSnapshot: true
  }));
  // State replies repeat body text alongside the full snapshot. Reserve16KiB for
  // bounded actor/session bookkeeping; the transport still enforces its real cap.
  const outputLineBytes = Buffer.byteLength(JSON.stringify({
    type: 'state',
    round: plan.rounds.length,
    text: projected.content.body,
    documentSnapshot: projected,
    editIds,
    assetHashes
  })) + 16 * 1024;
  if (inputLineBytes > 64 * 1024 || outputLineBytes > 256 * 1024) throw Error('Mixed projected JSONL line exceeds existing transport bound');
  return {
    ...plan.totals,
    bodyBytes,
    documentBytes,
    inputLineBytes,
    outputLineBytes
  };
}
