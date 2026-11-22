import {
  faChevronDown,
  faChevronRight,
  faFilter,
  faImage,
  faMagnifyingGlass,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Box, Collapse, Group, Paper, SegmentedControl, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core';
import { useMemo, useState } from 'react';
import Button from '@/elements/buttons/Button.tsx';
import Avatar from '@/elements/data-display/Avatar.tsx';
import Select from '@/elements/input/Select.tsx';
import TextInput from '@/elements/input/TextInput.tsx';
import type { EggAppearance, EggItem } from '../api/client.ts';
import {
  DELETED_GROUP,
  type EggGroup,
  filterPictureEggs,
  groupByNest,
  hasPictures,
  type PictureFilter,
  pictureCounts,
} from '../lib/eggGroups.ts';
import { BANNER_RATIO } from '../lib/images.ts';
import EggImage from './EggImage.tsx';

/** Below this many eggs the search and filters stay hidden. */
const FILTER_FROM = 7;
/** Nests with at most this many eggs start open; bigger ones start collapsed unless they are the only one. */
const OPEN_UP_TO = 6;

const NO_PICTURES: EggAppearance = { icon: null, banner: null };

interface EggPictureListProps {
  /** Eggs offered for pictures, see `appearanceEggs`. */
  uuids: string[];
  eggs: EggItem[];
  appearance: Record<string, EggAppearance>;
  canWrite: boolean;
  clearingEgg: string | null;
  onEdit: (egg: EggItem) => void;
  onClear: (uuid: string) => void;
}

/** The Icons and Banners list: search and filters, eggs grouped by nest in collapsible sections. */
export default function EggPictureList({
  uuids,
  eggs,
  appearance,
  canWrite,
  clearingEgg,
  onEdit,
  onClear,
}: EggPictureListProps) {
  const [query, setQuery] = useState('');
  const [nest, setNest] = useState<string | null>(null);
  const [pictures, setPictures] = useState<PictureFilter>('all');
  // nests opened or closed by hand; reset whenever the filters change so matches show up
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const eggItems = useMemo(() => new Map(eggs.map((egg) => [egg.uuid, egg])), [eggs]);
  const allGroups = useMemo(() => groupByNest(uuids, eggs), [uuids, eggs]);
  const counts = pictureCounts(uuids, appearance);
  const filtered = filterPictureEggs(uuids, eggs, appearance, { query, nest, pictures });
  const groups = groupByNest(filtered, eggs);
  const filtering = query.trim() !== '' || nest !== null || pictures !== 'all';

  const withFilterReset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setToggled({});
    };

  const isOpen = (group: EggGroup) =>
    toggled[group.key] ?? (filtering || groups.length === 1 || group.eggs.length <= OPEN_UP_TO);

  return (
    <Stack gap='sm'>
      {uuids.length >= FILTER_FROM && (
        <Group gap='xs' align='flex-end'>
          <TextInput
            aria-label='Search eggs'
            placeholder='Search eggs'
            leftSection={<FontAwesomeIcon icon={faMagnifyingGlass} />}
            value={query}
            onChange={(e) => withFilterReset(setQuery)(e.currentTarget.value)}
            style={{ flex: '2 1 200px' }}
          />
          {allGroups.length > 1 && (
            <Select
              aria-label='Filter by nest'
              placeholder='All nests'
              leftSection={<FontAwesomeIcon icon={faFilter} />}
              data={allGroups.map((group) => ({ value: group.key, label: `${group.nestName} (${group.eggs.length})` }))}
              value={nest}
              onChange={withFilterReset(setNest)}
              clearable
              style={{ flex: '1 1 180px' }}
            />
          )}
          <SegmentedControl
            aria-label='Filter by pictures'
            data={[
              { value: 'all', label: `All (${counts.all})` },
              { value: 'with', label: `With pictures (${counts.with})` },
              { value: 'without', label: `Without (${counts.without})` },
            ]}
            value={pictures}
            onChange={(value) => withFilterReset(setPictures)(value as PictureFilter)}
            style={{ maxWidth: '100%' }}
          />
        </Group>
      )}

      {groups.length === 0 ? (
        <Text c='dimmed' size='sm' ta='center' py='md'>
          No eggs match these filters.
        </Text>
      ) : (
        groups.map((group) => {
          const open = isOpen(group);
          const withPictures = group.eggs.filter((egg) => hasPictures(appearance[egg.uuid])).length;

          return (
            <div key={group.key}>
              <UnstyledButton
                onClick={() => setToggled((prev) => ({ ...prev, [group.key]: !open }))}
                aria-expanded={open}
                w='100%'
                py={4}
              >
                <Group gap='xs' wrap='nowrap'>
                  <Box w={16} c='dimmed'>
                    <FontAwesomeIcon icon={open ? faChevronDown : faChevronRight} />
                  </Box>
                  <Text size='sm' fw={600} c={group.key === DELETED_GROUP ? 'red' : undefined} truncate='end'>
                    {group.nestName}
                  </Text>
                  <Text size='xs' c='dimmed' style={{ flexShrink: 0 }}>
                    {group.eggs.length === 1 ? '1 egg' : `${group.eggs.length} eggs`} · {withPictures} with pictures
                  </Text>
                </Group>
              </UnstyledButton>

              <Collapse expanded={open}>
                <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing='xs' verticalSpacing='xs' pt={4} pb='xs'>
                  {group.eggs.map(({ uuid, name }) => {
                    const egg = eggItems.get(uuid);
                    const picture = appearance[uuid] ?? NO_PICTURES;
                    const set = [picture.icon && 'Icon', picture.banner && 'Banner'].filter(Boolean).join(' and ');

                    return (
                      <Paper key={uuid} withBorder radius='sm' px='xs' py={6}>
                        <Group wrap='nowrap' gap='sm'>
                          <Avatar
                            src={picture.icon}
                            name={name}
                            size={32}
                            radius='sm'
                            imageProps={{ referrerPolicy: 'no-referrer', draggable: false }}
                          />
                          <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                            <Text fw={600} size='sm' truncate='end' title={name}>
                              {name}
                            </Text>
                            <Text size='xs' c='dimmed' truncate='end'>
                              {set || 'No pictures'}
                            </Text>
                          </Stack>
                          <Box w={66} visibleFrom='xs' style={{ flexShrink: 0 }}>
                            <EggImage src={picture.banner} ratio={BANNER_RATIO} radius='xs' />
                          </Box>
                          {canWrite && (
                            <Group gap={4} wrap='nowrap' style={{ flexShrink: 0 }}>
                              {egg && (
                                <Button
                                  size='xs'
                                  variant='light'
                                  color='gray'
                                  aria-label={`Edit the icon and banner of ${egg.name}`}
                                  onClick={() => onEdit(egg)}
                                >
                                  <FontAwesomeIcon icon={faImage} />
                                </Button>
                              )}
                              {set && (
                                <Button
                                  size='xs'
                                  variant='subtle'
                                  color='red'
                                  aria-label={`Remove the icon and banner of ${name}`}
                                  loading={clearingEgg === uuid}
                                  onClick={() => onClear(uuid)}
                                >
                                  <FontAwesomeIcon icon={faTrash} />
                                </Button>
                              )}
                            </Group>
                          )}
                        </Group>
                      </Paper>
                    );
                  })}
                </SimpleGrid>
              </Collapse>
            </div>
          );
        })
      )}
    </Stack>
  );
}
