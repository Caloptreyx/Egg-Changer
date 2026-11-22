import {
  faArrowRight,
  faCircleExclamation,
  faCircleInfo,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Alert, List } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useEffect, useState } from 'react';
import { httpErrorToHuman } from '@/api/axios.ts';
import getServer from '@/api/server/getServer.ts';
import Button from '@/elements/buttons/Button.tsx';
import Avatar from '@/elements/data-display/Avatar.tsx';
import Badge from '@/elements/data-display/Badge.tsx';
import ThemeIcon from '@/elements/data-display/ThemeIcon.tsx';
import Checkbox from '@/elements/input/Checkbox.tsx';
import Select from '@/elements/input/Select.tsx';
import Switch from '@/elements/input/Switch.tsx';
import TextArea from '@/elements/input/TextArea.tsx';
import Group from '@/elements/layout/Group.tsx';
import Paper from '@/elements/layout/Paper.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import { Modal, ModalFooter } from '@/elements/modals/Modal.tsx';
import Text from '@/elements/typography/Text.tsx';
import { useServerCan } from '@/plugins/usePermissions.ts';
import { useToast } from '@/providers/ToastProvider.tsx';
import { useServerStore } from '@/stores/server.ts';
import { type ChangeEggResponse, type CurrentEgg, changeEgg, type TargetEgg } from '../api/client.ts';
import { changeEffects, defaultStartup, type EffectTone, effectiveChoices } from '../lib/eggs.ts';

const TONES: Record<EffectTone, { color: string | undefined; icon: typeof faCircleInfo }> = {
  info: { color: undefined, icon: faCircleInfo },
  warning: { color: 'yellow', icon: faTriangleExclamation },
  danger: { color: 'red', icon: faCircleExclamation },
};

const BUSY_STATUS: Record<string, string> = {
  installing: 'is installing',
  install_failed: 'has a failed installation',
  restoring_backup: 'is restoring a backup',
  backup_restore_failed: 'has a failed backup restore',
};

interface ChangeEggModalProps {
  opened: boolean;
  egg: TargetEgg;
  current: CurrentEgg;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onChanged: (result: ChangeEggResponse) => void;
}

/** Options for the switch and a plain summary of what it does, confirmed in one step. */
export default function ChangeEggModal({
  opened,
  egg,
  current,
  onClose,
  onBusyChange,
  onChanged,
}: ChangeEggModalProps) {
  const { addToast } = useToast();
  const server = useServerStore((state) => state.server);
  const setServer = useServerStore((state) => state.setServer);
  const canReinstall = useServerCan('settings.install');
  // Anything but the new egg's default command needs the core startup permission: keeping the
  // current one, another preset or a custom one. Likewise a non-default image needs the image one.
  const canStartupCommand = useServerCan('startup.command');
  const canDockerImage = useServerCan('startup.docker-image');
  const fullScreen = useMediaQuery('(max-width: 36em)');

  const [updateStartup, setUpdateStartup] = useState(true);
  const [startup, setStartup] = useState('');
  const [image, setImage] = useState('');
  const [reinstall, setReinstall] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // every newly picked egg starts from its defaults
  useEffect(() => {
    setUpdateStartup(true);
    setStartup(defaultStartup(egg));
    setImage(egg.docker_images[0]?.value ?? '');
    setReinstall(false);
    setWipe(false);
    setUnderstood(false);
  }, [egg]);

  const choices = { updateStartup, startup, image, reinstall, wipe };
  const { updatingStartup, reinstalling, wiping } = effectiveChoices(egg, choices);
  const effects = changeEffects({ eggName: current.name, image: server.image }, egg, choices);
  const busyStatus = reinstalling && server.status ? (BUSY_STATUS[server.status] ?? 'is busy') : null;

  const customStartup = egg.allow_custom_startup_command && canStartupCommand;
  const showStartupPicker = updatingStartup && canStartupCommand && (egg.startup_commands.length > 1 || customStartup);
  const presetValue = egg.startup_commands.some((c) => c.value === startup) ? startup : null;

  const close = () => {
    if (!submitting) onClose();
  };

  const submit = async () => {
    setSubmitting(true);
    onBusyChange(true);
    try {
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
      onChanged(result);
      setServer(await getServer(server.uuid));
    } catch (err) {
      addToast(httpErrorToHuman(err), 'error');
    } finally {
      setSubmitting(false);
      onBusyChange(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={`Switch to ${egg.name}`}
      size='lg'
      fullScreen={fullScreen}
      closeOnClickOutside={!submitting}
      closeOnEscape={!submitting}
      withCloseButton={!submitting}
    >
      <Stack gap='lg'>
        <Group wrap='nowrap' gap='sm' align='stretch'>
          {[
            { label: 'From', name: current.name, nest: current.nest_name },
            { label: 'To', name: egg.name, nest: egg.nest_name },
          ].map((side, i) => (
            <Group key={side.label} wrap='nowrap' gap='sm' style={{ flex: 1, minWidth: 0 }}>
              {i === 1 && (
                <Text c='dimmed' aria-hidden>
                  <FontAwesomeIcon icon={faArrowRight} />
                </Text>
              )}
              <Paper withBorder radius='md' p='sm' style={{ flex: 1, minWidth: 0 }}>
                <Group wrap='nowrap' gap='sm'>
                  <Avatar name={side.name} size='md' radius='md' />
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Text size='xs' c='dimmed'>
                      {side.label}
                    </Text>
                    <Text fw={600} size='sm' truncate='end'>
                      {side.name}
                    </Text>
                    <Text size='xs' c='dimmed' truncate='end'>
                      {side.nest}
                    </Text>
                  </Stack>
                </Group>
              </Paper>
            </Group>
          ))}
        </Group>

        <Stack gap='sm'>
          {!egg.options.force_startup_update && canStartupCommand && (
            <Switch
              label={`Use ${egg.name}'s startup command`}
              description='Turn off to keep the current startup command.'
              checked={updateStartup}
              disabled={submitting}
              onChange={(e) => setUpdateStartup(e.currentTarget.checked)}
            />
          )}

          {showStartupPicker && (
            <Select
              label={customStartup ? 'Startup preset' : 'Startup command'}
              data={egg.startup_commands.map((c) => ({ value: c.value, label: c.name }))}
              value={presetValue}
              placeholder={customStartup ? 'Custom' : undefined}
              disabled={submitting}
              onChange={(value) => value && setStartup(value)}
            />
          )}

          {customStartup && updatingStartup && (
            <TextArea
              label='Startup command'
              autosize
              minRows={2}
              maxRows={6}
              value={startup}
              disabled={submitting}
              onChange={(e) => setStartup(e.currentTarget.value)}
            />
          )}

          {egg.docker_images.length > 1 && canDockerImage && (
            <Select
              label='Docker image'
              data={egg.docker_images.map((i) => ({ value: i.value, label: i.name }))}
              value={image}
              disabled={submitting}
              onChange={(value) => value && setImage(value)}
            />
          )}

          {canReinstall && (
            <Switch
              label='Reinstall the server'
              description={
                egg.options.force_reinstall
                  ? `Your host always reinstalls when switching to ${egg.name}.`
                  : `Runs ${egg.name}'s install script after switching.`
              }
              checked={reinstalling}
              disabled={submitting || egg.options.force_reinstall}
              onChange={(e) => {
                setReinstall(e.currentTarget.checked);
                if (!e.currentTarget.checked) setWipe(false);
              }}
            />
          )}

          {reinstalling && (
            <Switch
              color='red'
              label='Delete all files before reinstalling'
              description={
                egg.options.force_truncate
                  ? `Your host always deletes the files when reinstalling into ${egg.name}.`
                  : 'Starts from an empty server. This cannot be undone.'
              }
              checked={wiping}
              disabled={submitting || egg.options.force_truncate}
              onChange={(e) => {
                setWipe(e.currentTarget.checked);
                setUnderstood(false);
              }}
            />
          )}
        </Stack>

        <Paper withBorder radius='md' p='md'>
          <Text fw={600} size='sm' mb='sm'>
            What happens
          </Text>
          <List spacing='sm' size='sm'>
            {effects.map((effect) => (
              <List.Item
                key={effect.key}
                icon={
                  <ThemeIcon size={22} radius='xl' variant='light' color={TONES[effect.tone].color}>
                    <FontAwesomeIcon icon={TONES[effect.tone].icon} size='xs' />
                  </ThemeIcon>
                }
              >
                {effect.text}
                {effect.forced && (
                  <Badge size='xs' variant='outline' color='gray' ml={6}>
                    Set by your host
                  </Badge>
                )}
              </List.Item>
            ))}
          </List>
        </Paper>

        {busyStatus && (
          <Alert color='red' variant='light' icon={<FontAwesomeIcon icon={faCircleExclamation} />}>
            The server {busyStatus}, so it can't be reinstalled right now.
          </Alert>
        )}

        {wiping && (
          <Checkbox
            color='red'
            label='I understand that every file of this server is deleted.'
            checked={understood}
            disabled={submitting}
            onChange={(e) => setUnderstood(e.currentTarget.checked)}
          />
        )}

        <ModalFooter>
          <Button variant='default' onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button
            color={wiping ? 'red' : undefined}
            loading={submitting}
            disabled={
              (updatingStartup && startup.trim() === '') || image === '' || (wiping && !understood) || !!busyStatus
            }
            onClick={submit}
          >
            {wiping ? 'Delete files and switch' : reinstalling ? 'Switch and reinstall' : 'Switch egg'}
          </Button>
        </ModalFooter>
      </Stack>
    </Modal>
  );
}
