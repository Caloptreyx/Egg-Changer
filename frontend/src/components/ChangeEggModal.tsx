import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Alert, List, Stack, Text } from '@mantine/core';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { httpErrorToHuman } from '@/api/axios.ts';
import getServer from '@/api/server/getServer.ts';
import Button from '@/elements/buttons/Button.tsx';
import Select from '@/elements/input/Select.tsx';
import Switch from '@/elements/input/Switch.tsx';
import TextArea from '@/elements/input/TextArea.tsx';
import { Modal, ModalFooter } from '@/elements/modals/Modal.tsx';
import { useServerCan } from '@/plugins/usePermissions.ts';
import { useToast } from '@/providers/ToastProvider.tsx';
import { useServerStore } from '@/stores/server.ts';
import { changeEgg, type EggChangerIndex } from '../api/client.ts';

interface ChangeEggModalProps {
  opened: boolean;
  onClose: () => void;
  index: EggChangerIndex;
}

export default function ChangeEggModal({ opened, onClose, index }: ChangeEggModalProps) {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const server = useServerStore((state) => state.server);
  const setServer = useServerStore((state) => state.setServer);
  const canReinstall = useServerCan('settings.install');

  const [eggUuid, setEggUuid] = useState<string | null>(null);
  const [startup, setStartup] = useState('');
  const [image, setImage] = useState('');
  const [updateStartup, setUpdateStartup] = useState(true);
  const [reinstall, setReinstall] = useState(false);
  const [truncateDirectory, setTruncateDirectory] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const egg = index.eggs.find((e) => e.uuid === eggUuid) ?? null;
  // options the egg's rules force override the user's choices
  const updatingStartup = updateStartup || !!egg?.options.force_startup_update;
  const reinstalling = reinstall || !!egg?.options.force_reinstall;
  const wiping = reinstalling && (truncateDirectory || !!egg?.options.force_truncate);

  const eggOptions = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const target of index.eggs) {
      const items = groups.get(target.nest_name) ?? [];
      items.push({ value: target.uuid, label: target.name });
      groups.set(target.nest_name, items);
    }
    return [...groups].map(([group, items]) => ({ group, items }));
  }, [index.eggs]);

  const selectEgg = (uuid: string | null) => {
    const target = index.eggs.find((e) => e.uuid === uuid);
    setEggUuid(uuid);
    // same default as the backend: the command named "Default", else the first one
    const command = target?.startup_commands.find((c) => c.name === 'Default') ?? target?.startup_commands[0];
    setStartup(command?.value ?? '');
    setImage(target?.docker_images[0]?.value ?? '');
  };

  const reset = () => {
    selectEgg(null);
    setUpdateStartup(true);
    setReinstall(false);
    setTruncateDirectory(false);
  };

  const close = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const submit = async () => {
    if (!egg) return;

    try {
      setSubmitting(true);
      const result = await changeEgg(server.uuid, {
        egg_uuid: egg.uuid,
        startup: updatingStartup ? startup : null,
        image,
        keep_startup: !updatingStartup,
        reinstall: reinstalling,
        truncate_directory: wiping,
      });

      addToast(
        result.reinstalling
          ? `Switched to ${result.egg.name}, the server is reinstalling.`
          : `Switched to ${result.egg.name}. Restart the server to apply the change.`,
        'success',
      );
      if (result.allocations.length > 0) {
        addToast(`Assigned allocations: ${result.allocations.map((a) => `${a.ip}:${a.port}`).join(', ')}`, 'success');
      }

      setServer(await getServer(server.uuid));
      setSubmitting(false);
      reset();
      onClose();
      if (result.reinstalling) {
        navigate(`/server/${server.uuidShort}`);
      }
    } catch (err) {
      addToast(httpErrorToHuman(err), 'error');
      setSubmitting(false);
    }
  };

  const presetValue = egg?.startup_commands.some((c) => c.value === startup) ? startup : null;

  return (
    <Modal opened={opened} onClose={close} title='Change Egg' size='lg'>
      <Stack gap='md'>
        <Text size='sm'>
          Currently running <b>{index.current_egg.name}</b>.
        </Text>

        <Select
          label='New egg'
          placeholder='Select an egg'
          data={eggOptions}
          value={eggUuid}
          onChange={selectEgg}
          searchable
        />

        {egg?.description && (
          <Text size='xs' c='dimmed'>
            {egg.description}
          </Text>
        )}

        {egg && !egg.options.force_startup_update && (
          <Switch
            label='Update the startup command'
            description='Turn off to keep the current startup command.'
            checked={updateStartup}
            onChange={(e) => setUpdateStartup(e.currentTarget.checked)}
          />
        )}

        {egg && updatingStartup && (egg.startup_commands.length > 1 || egg.allow_custom_startup_command) && (
          <Select
            label={egg.allow_custom_startup_command ? 'Startup preset' : 'Startup command'}
            data={egg.startup_commands.map((c) => ({ value: c.value, label: c.name }))}
            value={presetValue}
            placeholder={egg.allow_custom_startup_command ? 'Custom' : undefined}
            onChange={(value) => value && setStartup(value)}
          />
        )}

        {egg?.allow_custom_startup_command && updatingStartup && (
          <TextArea
            label='Startup command'
            autosize
            minRows={2}
            value={startup}
            onChange={(e) => setStartup(e.currentTarget.value)}
          />
        )}

        {egg && egg.docker_images.length > 1 && (
          <Select
            label='Docker image'
            data={egg.docker_images.map((i) => ({ value: i.value, label: i.name }))}
            value={image}
            onChange={(value) => value && setImage(value)}
          />
        )}

        {egg && (canReinstall || egg.options.force_reinstall) && (
          <Switch
            label='Reinstall the server'
            description={
              egg.options.force_reinstall
                ? `Always done when switching to ${egg.name}.`
                : "Runs the new egg's install script after switching."
            }
            checked={reinstalling}
            disabled={egg.options.force_reinstall}
            onChange={(e) => {
              setReinstall(e.currentTarget.checked);
              if (!e.currentTarget.checked) setTruncateDirectory(false);
            }}
          />
        )}

        {egg && reinstalling && (
          <Switch
            color='red'
            label='Wipe all files before reinstalling'
            description={
              egg.options.force_truncate
                ? `Always done when reinstalling into ${egg.name}. This cannot be undone.`
                : 'Deletes every file of this server. This cannot be undone.'
            }
            checked={wiping}
            disabled={egg.options.force_truncate}
            onChange={(e) => setTruncateDirectory(e.currentTarget.checked)}
          />
        )}

        {egg && (
          <Alert color='yellow' icon={<FontAwesomeIcon icon={faTriangleExclamation} />}>
            <List size='sm' spacing={4}>
              <List.Item>All startup variables are reset to the defaults of {egg.name}.</List.Item>
              {egg.deployment_allocations > 0 && (
                <List.Item>
                  This egg needs up to {egg.deployment_allocations} additional allocation
                  {egg.deployment_allocations === 1 ? '' : 's'}. Allocations the server already has are reused where
                  they fit.
                </List.Item>
              )}
              {!updatingStartup && <List.Item>The current startup command is kept.</List.Item>}
              {!reinstalling && <List.Item>Files are kept, the new egg's install script is not run.</List.Item>}
              {wiping && <List.Item>All files of this server are deleted before reinstalling.</List.Item>}
            </List>
          </Alert>
        )}

        <ModalFooter>
          <Button variant='default' onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button
            color='red'
            loading={submitting}
            disabled={!egg || (updatingStartup && startup.trim() === '') || image === ''}
            onClick={submit}
          >
            Change Egg
          </Button>
        </ModalFooter>
      </Stack>
    </Modal>
  );
}
