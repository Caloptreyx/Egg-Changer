import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EggAppearance, EggItem } from '../frontend/src/api/client.ts';
import {
  filterPictureEggs,
  filterRules,
  groupByNest,
  groupSummary,
  pictureCounts,
} from '../frontend/src/lib/eggGroups.ts';

function egg(uuid: string, name: string, nest_uuid: string, nest_name: string): EggItem {
  return { uuid, name, nest_uuid, nest_name };
}

// panel order: nests by name, then each nest's eggs
const EGGS: EggItem[] = [
  egg('cs', 'Code Server', 'code', 'Code Servers'),
  egg('paper', 'Paper', 'mc', 'Minecraft'),
  egg('vanilla', 'Vanilla', 'mc', 'Minecraft'),
  egg('forge', 'Forge', 'mc', 'Minecraft'),
  egg('fabric', 'Fabric', 'mc', 'Minecraft'),
  egg('valheim', 'Valheim', 'games', 'Survival Games'),
];

test('eggs are grouped by nest in panel order, deleted eggs last, each egg once', () => {
  const groups = groupByNest(['valheim', 'gone-1234567890', 'vanilla', 'paper', 'vanilla'], EGGS);

  assert.deepEqual(
    groups.map((group) => [group.nestName, group.eggs.map((e) => e.name), group.nestSize]),
    [
      ['Minecraft', ['Paper', 'Vanilla'], 4],
      ['Survival Games', ['Valheim'], 1],
      ['Deleted eggs', ['Deleted egg gone-123'], 1],
    ],
  );
});

test('a group summary names few eggs, says "All" for a whole nest and counts the rest', () => {
  const [few] = groupByNest(['paper', 'vanilla'], EGGS);
  assert.equal(groupSummary(few), 'Paper, Vanilla');

  const [whole] = groupByNest(['paper', 'vanilla', 'forge', 'fabric'], EGGS);
  assert.equal(groupSummary(whole), 'All 4 eggs');

  const [part] = groupByNest(['paper', 'vanilla', 'forge', 'fabric'], [...EGGS, egg('neo', 'NeoForge', 'mc', 'Minecraft')]);
  assert.equal(groupSummary(part), 'Paper, Vanilla and 2 more');
});

test('rules are found by an egg or nest name on either side, matching every word on one egg', () => {
  const rules = [
    { id: 'mc', eggs: ['paper'], allowed_eggs: ['vanilla'] },
    { id: 'code', eggs: ['cs'], allowed_eggs: ['valheim'] },
  ];

  assert.deepEqual(
    filterRules(rules, EGGS, 'VANILLA').map((rule) => rule.id),
    ['mc'],
  );
  assert.deepEqual(
    filterRules(rules, EGGS, 'survival').map((rule) => rule.id),
    ['code'],
  );
  assert.deepEqual(
    filterRules(rules, EGGS, 'minecraft valheim').map((rule) => rule.id),
    [],
  );
  assert.equal(filterRules(rules, EGGS, '  ').length, 2);
});

test('the icons list filters by name, nest and whether an egg has pictures', () => {
  const appearance: Record<string, EggAppearance> = {
    paper: { icon: 'https://example.com/paper.png', banner: null },
    vanilla: { icon: null, banner: null },
    gone: { icon: null, banner: 'https://example.com/gone.png' },
  };
  const uuids = ['paper', 'vanilla', 'valheim', 'gone'];

  assert.deepEqual(pictureCounts(uuids, appearance), { all: 4, with: 2, without: 2 });
  assert.deepEqual(filterPictureEggs(uuids, EGGS, appearance, { query: '', nest: null, pictures: 'with' }), [
    'paper',
    'gone',
  ]);
  assert.deepEqual(filterPictureEggs(uuids, EGGS, appearance, { query: '', nest: 'mc', pictures: 'without' }), [
    'vanilla',
  ]);
  assert.deepEqual(filterPictureEggs(uuids, EGGS, appearance, { query: 'deleted', nest: null, pictures: 'all' }), [
    'gone',
  ]);
  assert.deepEqual(filterPictureEggs(uuids, EGGS, appearance, { query: 'val', nest: 'deleted', pictures: 'all' }), []);
});
