// node --test windows/scripts/live-browser-ready.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedEditorReady } from './live-browser-ready.mjs';

const ITEM = '5f211864-df09-4bf6-9410-918c19dfb0eb';
const OTHER = 'a7d2b4f7-2e8e-4b05-8f61-76a4901afb9d';

// Minimal document double: a list of sections, each with a state, item and
// optional editor. Only the selectors the gate uses are supported.
function fakeDocument(sections) {
  const section = s => ({
    getAttribute: name => name === 'data-collaboration-item' ? s.item ?? null : null,
    querySelector: selector => selector === '[aria-label="Document body"]' && s.editor ? { isContentEditable: s.editor === 'editable' } : null,
  });
  return {
    querySelector(selector) {
      assert.equal(selector, '[data-collaboration-state="ready"]');
      const hit = sections.find(s => s.state === 'ready');
      return hit ? section(hit) : null;
    },
  };
}

test('passes only when the ready section is the planned item with an editable body', () => {
  assert.equal(sharedEditorReady(ITEM, fakeDocument([{ state: 'ready', item: ITEM, editor: 'editable' }])), true);
});

test('local-only editor (no shared section) does not pass', () => {
  assert.equal(sharedEditorReady(ITEM, fakeDocument([])), false);
});

test('shared section still connecting does not pass even with a visible textbox', () => {
  assert.equal(sharedEditorReady(ITEM, fakeDocument([{ state: 'connecting', item: ITEM, editor: 'editable' }])), false);
});

test('ready section for a different item does not pass', () => {
  assert.equal(sharedEditorReady(ITEM, fakeDocument([{ state: 'ready', item: OTHER, editor: 'editable' }])), false);
});

test('ready section whose body is read-only does not pass', () => {
  assert.equal(sharedEditorReady(ITEM, fakeDocument([{ state: 'ready', item: ITEM, editor: 'readonly' }])), false);
  assert.equal(sharedEditorReady(ITEM, fakeDocument([{ state: 'ready', item: ITEM }])), false);
});

test('predicate is self-contained so Playwright can serialize it into the page', () => {
  const source = sharedEditorReady.toString();
  assert.match(source, /^function sharedEditorReady\(itemId, doc = globalThis\.document\)/);
  assert.doesNotMatch(source, /\b(require|import|process)\b/);
});
