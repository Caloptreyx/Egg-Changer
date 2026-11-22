import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EggRule, EggRuleOptions } from '../frontend/src/api/client.ts';
import { ruleOverlaps } from '../frontend/src/lib/rules.ts';

const PLAIN: EggRuleOptions = {
  force_startup_update: false,
  force_reinstall: false,
  force_truncate: false,
  reassign_allocations: false,
  force_backup: false,
};

function rule(id: string, eggs: string[], allowed_eggs: string[], options: Partial<EggRuleOptions> = {}): EggRule {
  return { id, eggs, allowed_eggs, options: { ...PLAIN, ...options } };
}

test('a rule sharing a source and target pair is reported with the options it adds', () => {
  const strict = rule('strict', ['paper'], ['7dtd'], { force_reinstall: true, force_truncate: true });
  const overlaps = ruleOverlaps([strict], null, { eggs: ['paper', 'vanilla'], allowed_eggs: ['7dtd'], options: PLAIN });

  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].rule.id, 'strict');
  assert.deepEqual(overlaps[0].pairs, [['paper', '7dtd']]);
  assert.deepEqual(overlaps[0].addedOptions, ['force_reinstall', 'force_truncate']);
});

test('the rule being edited, disjoint rules and same-egg pairs are not overlaps', () => {
  const rules = [
    rule('self', ['paper'], ['7dtd']),
    rule('other-source', ['vanilla'], ['7dtd']),
    rule('other-target', ['paper'], ['rust']),
    // a server never switches to the egg it is on
    rule('group', ['paper', '7dtd'], ['paper']),
  ];
  assert.deepEqual(ruleOverlaps(rules, 'self', { eggs: ['paper'], allowed_eggs: ['7dtd', 'paper'], options: PLAIN }), []);
});

test('an overlapping rule forcing nothing extra still warns, with no added options', () => {
  const lenient = rule('lenient', ['paper'], ['7dtd']);
  const overlaps = ruleOverlaps([lenient], null, {
    eggs: ['paper'],
    allowed_eggs: ['7dtd'],
    options: { ...PLAIN, force_backup: true },
  });
  assert.equal(overlaps.length, 1);
  assert.deepEqual(overlaps[0].addedOptions, []);
});
