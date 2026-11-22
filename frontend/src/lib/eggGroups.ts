// Grouping and filtering for the admin page, which may list a hundred eggs. Kept free of React and
// panel imports so it can be tested with `node --test`.
import type { EggAppearance, EggItem, EggRule } from '../api/client.ts';

export interface GroupedEgg {
  uuid: string;
  name: string;
}

export interface EggGroup {
  /** `deleted` for eggs the panel no longer has. */
  key: string;
  nestName: string;
  eggs: GroupedEgg[];
  /** How many eggs the nest has on the panel; equal to `eggs.length` when the group is the whole nest. */
  nestSize: number;
}

export const DELETED_GROUP = 'deleted';

/** Label for an egg the panel no longer has. */
export function deletedEggName(uuid: string): string {
  return `Deleted egg ${uuid.slice(0, 8)}`;
}

/**
 * `uuids` grouped by nest, nests and eggs in the panel's order (`eggs`, as the backend lists them),
 * eggs the panel no longer has last. Duplicates are listed once.
 */
export function groupByNest(uuids: string[], eggs: EggItem[]): EggGroup[] {
  const wanted = new Set(uuids);
  const groups = new Map<string, EggGroup>();
  const nestSizes = new Map<string, number>();

  for (const egg of eggs) {
    nestSizes.set(egg.nest_uuid, (nestSizes.get(egg.nest_uuid) ?? 0) + 1);
    if (!wanted.delete(egg.uuid)) continue;

    let group = groups.get(egg.nest_uuid);
    if (!group) {
      group = { key: egg.nest_uuid, nestName: egg.nest_name, eggs: [], nestSize: 0 };
      groups.set(egg.nest_uuid, group);
    }
    group.eggs.push({ uuid: egg.uuid, name: egg.name });
  }

  const result = [...groups.values()].map((group) => ({ ...group, nestSize: nestSizes.get(group.key) ?? 0 }));
  if (wanted.size > 0) {
    const deleted = [...wanted].map((uuid) => ({ uuid, name: deletedEggName(uuid) }));
    result.push({ key: DELETED_GROUP, nestName: 'Deleted eggs', eggs: deleted, nestSize: deleted.length });
  }
  return result;
}

/** A collapsed rule side lists this many nests, each with at most this many egg names. */
export const SUMMARY_NESTS = 3;
export const SUMMARY_NAMES = 3;

/**
 * One line about a group: its egg names when there are at most `maxNames`, "All 78 eggs" when it is
 * the whole nest, otherwise the first names and how many more.
 */
export function groupSummary(group: EggGroup, maxNames = SUMMARY_NAMES): string {
  const count = group.eggs.length;
  if (count <= maxNames) return group.eggs.map((egg) => egg.name).join(', ');
  if (group.key !== DELETED_GROUP && count === group.nestSize) return `All ${count} eggs`;
  const shown = Math.max(1, maxNames - 1);
  const names = group.eggs
    .slice(0, shown)
    .map((egg) => egg.name)
    .join(', ');
  return `${names} and ${count - shown} more`;
}

/** Whether the collapsed summary of `groups` leaves out egg names, so a "show all" is worth offering. */
export function summaryHidesEggs(groups: EggGroup[]): boolean {
  return groups.length > SUMMARY_NESTS || groups.some((group) => group.eggs.length > SUMMARY_NAMES);
}

function words(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function eggMatches(egg: EggItem | undefined, uuid: string, queryWords: string[]): boolean {
  const haystack = (egg ? `${egg.name} ${egg.nest_name}` : deletedEggName(uuid)).toLowerCase();
  return queryWords.every((word) => haystack.includes(word));
}

/** Rules with a source or target egg whose name and nest contain every word of `query`. */
export function filterRules<T extends Pick<EggRule, 'eggs' | 'allowed_eggs'>>(
  rules: T[],
  eggs: EggItem[],
  query: string,
): T[] {
  const queryWords = words(query);
  if (queryWords.length === 0) return rules;

  const byUuid = new Map(eggs.map((egg) => [egg.uuid, egg]));
  return rules.filter((rule) =>
    [...rule.eggs, ...rule.allowed_eggs].some((uuid) => eggMatches(byUuid.get(uuid), uuid, queryWords)),
  );
}

export type PictureFilter = 'all' | 'with' | 'without';

export function hasPictures(appearance: EggAppearance | undefined): boolean {
  return !!(appearance?.icon || appearance?.banner);
}

export interface PictureCounts {
  all: number;
  with: number;
  without: number;
}

export function pictureCounts(uuids: string[], appearance: Record<string, EggAppearance>): PictureCounts {
  const withPictures = uuids.filter((uuid) => hasPictures(appearance[uuid])).length;
  return { all: uuids.length, with: withPictures, without: uuids.length - withPictures };
}

export interface PictureQuery {
  query: string;
  /** A group key from `groupByNest`, or null for every nest. */
  nest: string | null;
  pictures: PictureFilter;
}

/** The eggs of the Icons and Banners list that match the search, nest and picture filters. */
export function filterPictureEggs(
  uuids: string[],
  eggs: EggItem[],
  appearance: Record<string, EggAppearance>,
  { query, nest, pictures }: PictureQuery,
): string[] {
  const queryWords = words(query);
  const byUuid = new Map(eggs.map((egg) => [egg.uuid, egg]));

  return uuids.filter((uuid) => {
    const egg = byUuid.get(uuid);
    if (nest && (egg?.nest_uuid ?? DELETED_GROUP) !== nest) return false;
    if (pictures !== 'all' && hasPictures(appearance[uuid]) !== (pictures === 'with')) return false;
    return eggMatches(egg, uuid, queryWords);
  });
}
