import { faCircleCheck, faEgg, faFilter, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Alert, SimpleGrid, Skeleton } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { httpErrorToHuman } from '@/api/axios.ts';
import Avatar from '@/elements/data-display/Avatar.tsx';
import Badge from '@/elements/data-display/Badge.tsx';
import TitleCard from '@/elements/data-display/TitleCard.tsx';
import EmptyState from '@/elements/feedback/EmptyState.tsx';
import ErrorState from '@/elements/feedback/ErrorState.tsx';
import Select from '@/elements/input/Select.tsx';
import TextInput from '@/elements/input/TextInput.tsx';
import Group from '@/elements/layout/Group.tsx';
import Paper from '@/elements/layout/Paper.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import Text from '@/elements/typography/Text.tsx';
import Title from '@/elements/typography/Title.tsx';
import { useServerCan } from '@/plugins/usePermissions.ts';
import { useServerStore } from '@/stores/server.ts';
import { type ChangeEggResponse, type EggChangerIndex, getEggChangerIndex, type TargetEgg } from '../api/client.ts';
import { filterEggs, nestsOf, switchBlocker } from '../lib/eggs.ts';
import ChangeEggModal from './ChangeEggModal.tsx';
import EggCard from './EggCard.tsx';

/** Search and the nest filter only show up once there is something to narrow down. */
const FILTER_THRESHOLD = 6;

interface EggChangerProps {
  /**
   * `page`: the content of the sidebar page, with loading, error and empty states.
   * `section`: a full-width card on the server's Settings page, hidden (as before 1.1.0) unless the
   * user may change eggs and a rule offers at least one egg.
   */
  variant: 'page' | 'section';
}

/** Browse the eggs this server may switch to and switch, in either placement. */
export default function EggChanger({ variant }: EggChangerProps) {
  const navigate = useNavigate();
  const server = useServerStore((state) => state.server);
  const canChange = useServerCan('eggchanger.change');
  const canReinstall = useServerCan('settings.install');

  const [index, setIndex] = useState<EggChangerIndex | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const [query, setQuery] = useState('');
  const [nest, setNest] = useState<string | null>(null);
  const [selected, setSelected] = useState<TargetEgg | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ChangeEggResponse | null>(null);

  useEffect(() => {
    if (!canChange) return;

    let cancelled = false;
    setLoading(true);
    setLoadError('');
    getEggChangerIndex(server.uuid)
      .then((data) => {
        if (!cancelled) setIndex(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(httpErrorToHuman(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canChange, server.uuid, server.egg.uuid, reloadKey]);

  const eggs = index?.eggs ?? [];
  const nests = useMemo(() => nestsOf(eggs), [eggs]);
  const visible = useMemo(() => filterEggs(eggs, query, nest), [eggs, query, nest]);
  const showFilters = eggs.length > FILTER_THRESHOLD || nests.length > 1;

  // a nest that disappeared after a switch would otherwise filter out everything
  useEffect(() => {
    if (nest && !nests.some((n) => n.uuid === nest)) setNest(null);
  }, [nest, nests]);

  if (!canChange) return null;

  const changed = (response: ChangeEggResponse) => {
    setModalOpen(false);
    setResult(response);
    setQuery('');
    if (response.reinstalling) {
      // the console shows the install progress
      navigate(`/server/${server.uuidShort}`);
    }
  };

  let content;
  if (!index) {
    if (variant === 'section' && !loadError) return null;
    content = loadError ? (
      <ErrorState error={loadError} onRetry={() => setReloadKey((key) => key + 1)} retrying={loading} />
    ) : (
      <Stack gap='md' aria-busy>
        <Skeleton height={88} radius='md' />
        <Skeleton height={36} radius='md' />
        <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={196} radius='md' />
          ))}
        </SimpleGrid>
      </Stack>
    );
  } else {
    if (variant === 'section' && index.eggs.length === 0 && !result) return null;

    content = (
      <Stack gap='md'>
        {result && (
          <Alert
            color='green'
            variant='light'
            icon={<FontAwesomeIcon icon={faCircleCheck} />}
            title={`Switched to ${result.egg.name}`}
            withCloseButton
            onClose={() => setResult(null)}
          >
            {result.reinstalling
              ? 'The server is reinstalling with the new egg.'
              : 'Restart the server to run the new egg.'}
            {result.allocations.length > 0 &&
              ` Assigned ports: ${result.allocations.map((a) => `${a.ip}:${a.port}`).join(', ')}.`}
          </Alert>
        )}

        <Paper withBorder radius='md' p='md'>
          <Group wrap='nowrap' gap='md' align='flex-start'>
            <Avatar name={index.current_egg.name} size='lg' radius='md' />
            <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
              <Text size='xs' c='dimmed' fw={600} tt='uppercase'>
                Current egg
              </Text>
              <Group gap='xs' wrap='wrap'>
                <Text fw={700} size='lg' style={{ overflowWrap: 'anywhere' }}>
                  {index.current_egg.name}
                </Text>
                <Badge variant='light' color='gray'>
                  {index.current_egg.nest_name}
                </Badge>
              </Group>
              {index.current_egg.description && (
                <Text size='sm' c='dimmed' lineClamp={2}>
                  {index.current_egg.description}
                </Text>
              )}
            </Stack>
          </Group>
        </Paper>

        {index.eggs.length === 0 ? (
          <EmptyState
            icon={faEgg}
            title='No other eggs available'
            description={`Your host hasn't allowed switching from ${index.current_egg.name} to another egg.`}
          />
        ) : (
          <>
            <Group justify='space-between' align='flex-end' gap='sm'>
              <div>
                <Title order={4}>Available eggs</Title>
                <Text size='sm' c='dimmed'>
                  Pick the game or server software to switch this server to.
                </Text>
              </div>
              {showFilters && (
                <Group gap='sm' wrap='wrap' style={{ flex: '1 1 320px', justifyContent: 'flex-end' }}>
                  <TextInput
                    aria-label='Search eggs'
                    placeholder='Search eggs'
                    leftSection={<FontAwesomeIcon icon={faMagnifyingGlass} />}
                    value={query}
                    onChange={(e) => setQuery(e.currentTarget.value)}
                    style={{ flex: '1 1 200px' }}
                  />
                  {nests.length > 1 && (
                    <Select
                      aria-label='Filter by nest'
                      placeholder='All nests'
                      leftSection={<FontAwesomeIcon icon={faFilter} />}
                      data={nests.map((n) => ({ value: n.uuid, label: `${n.name} (${n.count})` }))}
                      value={nest}
                      onChange={setNest}
                      clearable
                      style={{ flex: '1 1 180px' }}
                    />
                  )}
                </Group>
              )}
            </Group>

            {visible.length === 0 ? (
              <Paper withBorder radius='md' p='xl'>
                <Text c='dimmed' ta='center' size='sm'>
                  No eggs match your search.
                </Text>
              </Paper>
            ) : (
              <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }}>
                {visible.map((egg) => (
                  <EggCard
                    key={egg.uuid}
                    egg={egg}
                    disabled={busy}
                    blocker={switchBlocker(egg, canReinstall)}
                    onSelect={() => {
                      setSelected(egg);
                      setModalOpen(true);
                    }}
                  />
                ))}
              </SimpleGrid>
            )}
          </>
        )}

        {selected && (
          <ChangeEggModal
            opened={modalOpen}
            egg={selected}
            current={index.current_egg}
            onClose={() => setModalOpen(false)}
            onBusyChange={setBusy}
            onChanged={changed}
          />
        )}
      </Stack>
    );
  }

  if (variant === 'page') return content;

  return (
    <div style={{ gridColumn: '1 / -1', order: 70 }}>
      <TitleCard title='Change Egg' icon={<FontAwesomeIcon icon={faEgg} />}>
        {content}
      </TitleCard>
    </div>
  );
}
