// Admin rule checks. Kept free of React and panel imports so it can be tested with `node --test`.
import type { EggRule, EggRuleOptions } from '../api/client.ts';

export interface RuleOverlap {
  rule: EggRule;
  /** Switches (source egg, target egg) both rules allow. */
  pairs: [string, string][];
  /** Options the other rule forces that the edited one doesn't: they apply to those switches anyway. */
  addedOptions: (keyof EggRuleOptions)[];
}

/**
 * Other rules allowing some of the same switches as the rule being edited. The backend merges the
 * options of every rule allowing a switch, so anything either rule enables applies.
 */
export function ruleOverlaps(
  rules: EggRule[],
  editingId: string | null,
  rule: Pick<EggRule, 'eggs' | 'allowed_eggs' | 'options'>,
): RuleOverlap[] {
  const overlaps: RuleOverlap[] = [];

  for (const other of rules) {
    if (other.id === editingId) continue;

    const pairs: [string, string][] = [];
    for (const source of rule.eggs.filter((egg) => other.eggs.includes(egg))) {
      for (const target of rule.allowed_eggs.filter((egg) => other.allowed_eggs.includes(egg))) {
        // a server never switches to the egg it is on
        if (source !== target) pairs.push([source, target]);
      }
    }
    if (pairs.length === 0) continue;

    const addedOptions = (Object.keys(other.options) as (keyof EggRuleOptions)[]).filter(
      (key) => other.options[key] && !rule.options[key],
    );
    overlaps.push({ rule: other, pairs, addedOptions });
  }

  return overlaps;
}
