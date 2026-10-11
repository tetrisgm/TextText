import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBody } from './editor-projection.mjs';

test('browser stress uses document text, not layout-only trailing newlines', () => {
  const element = { textContent: 'Existing fixture text.\n', innerText: 'Existing fixture text.\n\n\n' };
  const doc = { querySelector: selector => selector === '[aria-label="Document body"]' ? element : null };
  assert.equal(readBody('[aria-label="Document body"]', doc), 'Existing fixture text.\n');
  assert.equal(readBody('.missing', doc), null);
});
