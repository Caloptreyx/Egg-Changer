import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placementOf, placementShells } from '../frontend/src/lib/placement.ts';

test('each placement mounts its shells', () => {
  assert.deepEqual(placementShells('settings'), { settings: true, page: false });
  assert.deepEqual(placementShells('page'), { settings: false, page: true });
  assert.deepEqual(placementShells('both'), { settings: true, page: true });
});

test('a missing or unknown placement keeps the Settings section, as before 1.1.0', () => {
  for (const value of [undefined, null, '', 'sidebar', 'Page', 1]) {
    assert.equal(placementOf(value), 'settings');
    assert.deepEqual(placementShells(value), { settings: true, page: false });
  }
});
