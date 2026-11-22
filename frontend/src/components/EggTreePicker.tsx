import { faChevronDown, faChevronRight, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { ActionIcon, Checkbox, Group, Input, Paper, ScrollArea, Stack, Text, TextInput } from '@mantine/core';
import { type ReactNode, useMemo, useState } from 'react';
import Button from '@/elements/buttons/Button.tsx';
import type { EggItem } from '../api/client.ts';

interface NestGroup {
  uuid: string;
  name: string;
  eggs: EggItem[];
}

/** A nest with every egg selected starts expanded only up to this many eggs, so big ones don't fill the list. */
const OPEN_FULL_NESTS_UP_TO = 8;

interface EggTreePickerProps {
  label: string;
  description: string;
  eggs: EggItem[];
  value: string[];
  onChange: (value: string[]) => void;
  /** Extra controls shown next to the selection count. */
  actions?: ReactNode;
}

/** Nest -> egg checkbox tree: a nest checkbox toggles every egg shown under it. */
export default function EggTreePicker({ label, description, eggs, value, onChange, actions }: EggTreePickerProps) {
  const [search, setSearch] = useState('');
  // Nests holding part of the selection start expanded; fully selected big nests stay collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const open = new Set<string>();
    for (const nest of new Set(eggs.map((egg) => egg.nest_uuid))) {
      const nestEggs = eggs.filter((egg) => egg.nest_uuid === nest);
      const count = nestEggs.filter((egg) => value.includes(egg.uuid)).length;
      if (count > 0 && (count < nestEggs.length || nestEggs.length <= OPEN_FULL_NESTS_UP_TO)) open.add(nest);
    }
    return open;
  });

  const selected = useMemo(() => new Set(value), [value]);

  const nests = useMemo(() => {
    const groups = new Map<string, NestGroup>();
    for (const egg of eggs) {
      let group = groups.get(egg.nest_uuid);
      if (!group) {
        group = { uuid: egg.nest_uuid, name: egg.nest_name, eggs: [] };
        groups.set(egg.nest_uuid, group);
      }
      group.eggs.push(egg);
    }
    return [...groups.values()];
  }, [eggs]);

  const query = search.trim().toLowerCase();
  const visibleNests = useMemo(() => {
    if (!query) return nests;
    return nests.flatMap((nest) => {
      if (nest.name.toLowerCase().includes(query)) return [nest];
      const matching = nest.eggs.filter((egg) => egg.name.toLowerCase().includes(query));
      return matching.length > 0 ? [{ ...nest, eggs: matching }] : [];
    });
  }, [nests, query]);

  const setEggs = (uuids: string[], checked: boolean) => {
    const next = new Set(selected);
    for (const uuid of uuids) {
      if (checked) {
        next.add(uuid);
      } else {
        next.delete(uuid);
      }
    }
    onChange([...next]);
  };

  const toggleExpanded = (uuid: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(uuid)) next.add(uuid);
      return next;
    });

  // searching: every egg shown, so "select all matches" picks exactly what the admin sees
  const matches = query ? visibleNests.flatMap((nest) => nest.eggs.map((egg) => egg.uuid)) : [];
  const matchesSelected = matches.filter((uuid) => selected.has(uuid)).length;
  const selectedNests = new Set(eggs.filter((egg) => selected.has(egg.uuid)).map((egg) => egg.nest_uuid)).size;

  return (
    <Input.Wrapper label={label} description={description} required>
      <Stack gap='xs' mt='xs'>
        <TextInput
          size='xs'
          placeholder='Search eggs or nests'
          leftSection={<FontAwesomeIcon icon={faMagnifyingGlass} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />

        {matches.length > 0 && (
          <Group justify='space-between' gap='xs'>
            <Text size='xs' c='dimmed'>
              {matches.length === 1 ? '1 match' : `${matches.length} matches`}, {matchesSelected} selected
            </Text>
            <Group gap={4}>
              <Button
                size='xs'
                variant='subtle'
                disabled={matchesSelected === matches.length}
                onClick={() => setEggs(matches, true)}
              >
                Select all matches
              </Button>
              <Button
                size='xs'
                variant='subtle'
                color='gray'
                disabled={matchesSelected === 0}
                onClick={() => setEggs(matches, false)}
              >
                Unselect matches
              </Button>
            </Group>
          </Group>
        )}

        <Paper withBorder radius='sm' p='xs'>
          <ScrollArea.Autosize mah={280} type='auto' offsetScrollbars='y'>
            {visibleNests.length === 0 ? (
              <Text size='sm' c='dimmed' ta='center' py='md'>
                {query ? 'No eggs match your search.' : 'No eggs on this panel.'}
              </Text>
            ) : (
              <Stack gap={4}>
                {visibleNests.map((nest) => {
                  const uuids = nest.eggs.map((egg) => egg.uuid);
                  const count = uuids.filter((uuid) => selected.has(uuid)).length;
                  // searching always shows the matching eggs
                  const open = query !== '' || expanded.has(nest.uuid);

                  return (
                    <div key={nest.uuid}>
                      <Group gap='xs' wrap='nowrap'>
                        <ActionIcon
                          variant='subtle'
                          color='gray'
                          size='sm'
                          disabled={query !== ''}
                          onClick={() => toggleExpanded(nest.uuid)}
                          aria-label={open ? `Collapse ${nest.name}` : `Expand ${nest.name}`}
                        >
                          <FontAwesomeIcon icon={open ? faChevronDown : faChevronRight} />
                        </ActionIcon>
                        <Checkbox
                          label={
                            <Text size='sm' fw={600}>
                              {nest.name}
                            </Text>
                          }
                          checked={count === uuids.length}
                          indeterminate={count > 0 && count < uuids.length}
                          onChange={() => setEggs(uuids, count < uuids.length)}
                        />
                        <Text size='xs' c='dimmed' ml='auto'>
                          {count}/{uuids.length}
                        </Text>
                      </Group>

                      {open && (
                        <Stack gap={6} pl={52} py={6}>
                          {nest.eggs.map((egg) => (
                            <Checkbox
                              key={egg.uuid}
                              label={egg.name}
                              checked={selected.has(egg.uuid)}
                              onChange={(e) => setEggs([egg.uuid], e.currentTarget.checked)}
                            />
                          ))}
                        </Stack>
                      )}
                    </div>
                  );
                })}
              </Stack>
            )}
          </ScrollArea.Autosize>
        </Paper>

        <Group justify='space-between'>
          <Text size='xs' c='dimmed'>
            {value.length} selected
            {selectedNests > 1 && ` in ${selectedNests} nests`}
          </Text>
          <Group gap='xs'>
            {actions}
            <Button size='xs' variant='subtle' color='gray' disabled={value.length === 0} onClick={() => onChange([])}>
              Clear
            </Button>
          </Group>
        </Group>
      </Stack>
    </Input.Wrapper>
  );
}
