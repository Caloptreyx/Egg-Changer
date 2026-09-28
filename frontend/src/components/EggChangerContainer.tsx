import { faEgg } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import Button from '@/elements/buttons/Button.tsx';
import TitleCard from '@/elements/data-display/TitleCard.tsx';
import Group from '@/elements/layout/Group.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import { useServerCan } from '@/plugins/usePermissions.ts';
import { useServerStore } from '@/stores/server.ts';
import { type EggChangerIndex, getEggChangerIndex } from '../api/client.ts';
import ChangeEggModal from './ChangeEggModal.tsx';

/** Server settings card; hidden unless the user may change eggs and a rule allows a target egg. */
export default function EggChangerContainer() {
  const server = useServerStore((state) => state.server);
  const canChange = useServerCan('eggchanger.change');
  const [index, setIndex] = useState<EggChangerIndex | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!canChange) return;

    let cancelled = false;
    getEggChangerIndex(server.uuid)
      .then((data) => {
        if (!cancelled) setIndex(data);
      })
      .catch((err) => console.error('Egg Changer: failed to load eggs', err));

    return () => {
      cancelled = true;
    };
  }, [canChange, server.uuid, server.egg.uuid]);

  if (!canChange || !index || index.eggs.length === 0) {
    return null;
  }

  return (
    <TitleCard title='Change Egg' icon={<FontAwesomeIcon icon={faEgg} />} className='h-full order-50'>
      <ChangeEggModal opened={modalOpen} onClose={() => setModalOpen(false)} index={index} />

      <Stack h='100%'>
        <Text size='sm'>
          This server runs <b>{index.current_egg.name}</b>. Switch it to another game or server software, for example
          from Java to Bedrock edition.
        </Text>

        <Group mt='auto'>
          <Button color='red' onClick={() => setModalOpen(true)}>
            Change Egg
          </Button>
        </Group>
      </Stack>
    </TitleCard>
  );
}
