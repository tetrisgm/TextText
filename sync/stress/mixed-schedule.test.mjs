import test from 'node:test';
import assert from 'node:assert/strict';
import { planRounds } from './coordinator.mjs';
import { validateMixedSchedule, createMixedSchedule, fieldOperations, preflightMixedDocument } from './mixed-schedule.mjs';
const make = kinds => ({
  version: 1,
  rounds: kinds.map(kind => ({
    kind
  }))
});
const baseline = {
  schemaVersion: 1,
  content: {
    title: 'Owned fixture',
    body: 'Existing fixture text.\n',
    subtitle: 'Existing subtitle.',
    tags: [],
    fields: {
      preserved: true
    },
    assets: []
  },
  presentation: {
    template: {
      id: 'texttext.article',
      version: 1
    },
    theme: {}
  }
};
const generate = (spec, seed = 42) => createMixedSchedule(spec, seed, planRounds(seed, spec.rounds.length));
test('canonical100-round mix has exact bounded counts and immutable plan', () => {
  const spec = make([...Array(40).fill('plain'), ...Array(20).fill('cli-writes'), ...Array(20).fill('typing'), ...Array(10).fill('fields'), ...Array(10).fill('history')]);
  const plan = generate(spec);
  assert.deepEqual(plan.totals, {
    semanticAdditions: 920,
    driverActions: 1000,
    cliPackWrites: 220,
    historyStages: 120
  });
  assert.equal(plan.rounds.length, 100);
  assert.equal(fieldOperations(plan.rounds).length, 920);
  assert.equal(generate(spec).sha256, plan.sha256);
  assert.notEqual(generate(spec, 43).sha256, plan.sha256);
  assert.throws(() => {
    plan.rounds[0].edits[0].text = 'tampered';
  });
  assert.throws(() => plan.spec.rounds.push({
    kind: 'plain'
  }));
  assert.equal(preflightMixedDocument(plan, baseline).semanticAdditions, 920);
});
test('strict descriptors refuse extra/future kinds and over-budget plans', () => {
  for (const spec of [make([]), make(Array(101).fill('plain')), make(['unknown']), {
    ...make(['plain']),
    extra: true
  }, {
    version: 2,
    rounds: [{
      kind: 'plain'
    }]
  }, {
    version: 1,
    rounds: [{
      kind: 'plain',
      role: 'mac-web'
    }]
  }]) assert.throws(() => validateMixedSchedule(spec));
  assert.throws(() => generate(make(Array(100).fill('typing'))), /budget/);
});
test('all five kinds reuse normal scoped IDs and preserve complete prior prefix', () => {
  const plan = generate(make(['plain', 'cli-writes', 'typing', 'fields', 'history']));
  assert.equal(plan.rounds[1].edits.find(e => e.fileWriteSequence).role, 'mac-cli');
  assert.equal(plan.rounds[2].edits.filter(e => e.inputSequence).length, 4);
  assert.equal(plan.rounds[3].edits.every(e => e.fieldEdits.length === 2), true);
  assert.equal(plan.rounds[4].edits.filter(e => e.undoRedo).length, 4);
  const operations = fieldOperations(plan.rounds.slice(0, 4));
  assert.equal(operations.length, 43);
  assert.equal(operations.some(e => e.id === 'r2-mac-cli-write1'), true);
  assert.equal(operations.some(e => e.id === 'r3-mac-app-input4'), true);
  assert.equal(operations.some(e => e.id === 'r4-pc-cli-subtitle'), true);
  assert.notEqual(generate(make(['history', 'fields', 'typing', 'cli-writes', 'plain'])).sha256, plan.sha256);
});
test('mixed scenario refuses absent subtitle before direct-file field input', () => {
  const initial=structuredClone(baseline);delete initial.content.subtitle;
  assert.throws(()=>preflightMixedDocument(generate(make(['plain'])),initial),/existing subtitle/);
});
test('actual baseline growth preflight refuses text/document overflow before input', () => {
  const plan = generate(make(['plain']));
  assert.throws(() => preflightMixedDocument(plan, {
    ...baseline,
    content: {
      ...baseline.content,
      body: 'x'.repeat(65530)
    }
  }), /body/);
  assert.throws(() => preflightMixedDocument(plan, {
    ...baseline,
    content: {
      ...baseline.content,
      fields: {
        blob: 'x'.repeat(262100)
      }
    }
  }), /document/);
});
test('projected JSONL input/output sizes refuse before actors accept edits', () => {
  const plan = generate(make(['plain']));
  const large = {
    ...baseline,
    content: {
      ...baseline.content,
      body: 'x'.repeat(40000),
      fields: {
        blob: 'x'.repeat(200000)
      }
    }
  };
  assert.throws(() => preflightMixedDocument(plan, large), /line/);
  assert.throws(() => preflightMixedDocument(plan, baseline, {
    assetHashes: {
      ['assets/' + 'a'.repeat(70000)]: 'a'.repeat(64)
    }
  }), /line/);
});
test('transformed commands obey existing real actor helper contracts', async () => {
  const {
      validateInputSequence
    } = await import('./input-sequence.mjs'),
    {
      validateUndoRedo
    } = await import('./undo-redo.mjs'),
    {
      validateFieldSequence
    } = await import('./multi-field-input.mjs'),
    {
      validateWriteSequence
    } = await import('./file-write-sequence.mjs');
  const plan = generate(make(Array.from({
    length: 100
  }, (_, i) => ['plain', 'cli-writes', 'typing', 'fields', 'history'][i % 5])));
  for (const edit of plan.rounds.flatMap(r => r.edits)) {
    assert.equal(validateInputSequence(edit), true);
    assert.equal(validateUndoRedo(edit), true);
    if (edit.fieldEdits) assert.equal(validateFieldSequence(edit.fieldEdits, edit.role), true);
    if (edit.fileWriteSequence) assert.equal(validateWriteSequence(edit, edit.role), true);
  }
  const writes = plan.rounds.flatMap(r => r.edits).filter(e => e.fileWriteSequence);
  assert.deepEqual(writes.slice(0, 4).map(e => [e.role, e.fileWriteSequence.mode]), [['mac-cli', 'atomic'], ['pc-cli', 'atomic'], ['mac-cli', 'in-place'], ['pc-cli', 'in-place']]);
});
test('reused fixture containing any future body or subtitle operation refuses preflight', () => {
  const plan = generate(make(['plain', 'fields', 'typing']));
  for (const operation of fieldOperations(plan.rounds)) {
    const reused = structuredClone(baseline);
    reused.content[operation.field] += operation.text;
    assert.throws(() => preflightMixedDocument(plan, reused), /already|ambiguous/);
  }
});
