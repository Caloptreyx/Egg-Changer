import {
  faArrowRight,
  faCircleExclamation,
  faCircleInfo,
  faLock,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Alert, List, Loader } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useEffect, useRef, useState } from 'react';
import { httpErrorToHuman } from '@/api/axios.ts';
import createBackup from '@/api/server/backups/createBackup.ts';
import getBackup from '@/api/server/backups/getBackup.ts';
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
import { backupName, changeEffects, defaultStartup, type EffectTone, effectiveChoices } from '../lib/eggs.ts';
import { BANNER_RATIO } from '../lib/images.ts';
import EggImage from './EggImage.tsx';

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

/**
 * An option the host's rule forces, as plain text: a disabled switch reads as switched off in
 * several themes.
 */
function ForcedOption({ label, description, color }: { label: string; description: string; color?: string }) {
  return (
    <Group wrap='nowrap' gap='sm' align='flex-start'>
      <ThemeIcon size={22} radius='xl' variant='light' color={color} mt={2}>
        <FontAwesomeIcon icon={faLock} size='xs' />
      </ThemeIcon>
      <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
        <Group gap={6} wrap='wrap'>
          <Text size='sm' fw={500}>
            {label}
          </Text>
          <Badge size='xs' variant='outline' color='gray'>
            Set by your host
          </Badge>
        </Group>
        <Text size='xs' c='dimmed'>
          {description}
        </Text>
      </Stack>
    </Group>
  );
}

interface ChangeEggModalProps {
  opened: boolean;
  egg: TargetEgg;
  current: CurrentEgg;
  /** Why the user can't create a backup first, or null when they can. */
  backupUnavailable: string | null;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onChanged: (result: ChangeEggResponse) => void;
}

/** How often and how long to wait for the backup made before switching. */
const BACKUP_POLL_MS = 3000;
const BACKUP_TIMEOUT_MS = 60 * 60 * 1000;

/** Options for the switch and a plain summary of what it does, confirmed in one step. */
export default function ChangeEggModal({
  opened,
  egg,
  current,
  backupUnavailable,
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
  /** The user's backup choice; null follows the default: on whenever the switch reinstalls. */
  const [backupChoice, setBackupChoice] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<'idle' | 'backup' | 'switch'>('idle');
  const mounted = useRef(true);
  const submitting = phase !== 'idle';

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // every newly picked egg starts from its defaults
  useEffect(() => {
    setUpdateStartup(true);
    setStartup(defaultStartup(egg));
    setImage(egg.docker_images[0]?.value ?? '');
    setReinstall(false);
    setWipe(false);
    setUnderstood(false);
    setBackupChoice(null);
  }, [egg]);

  const backupAvailable = backupUnavailable === null;
  const choices = {
    updateStartup,
    startup,
    image,
    reinstall,
    wipe,
    backup: backupAvailable && (backupChoice ?? (reinstall || egg.options.force_reinstall)),
  };
  const { updatingStartup, reinstalling, wiping, backingUp } = effectiveChoices(egg, choices);
  const effects = changeEffects({ eggName: current.name, image: server.image }, egg, choices);
  const busyStatus = reinstalling && server.status ? (BUSY_STATUS[server.status] ?? 'is busy') : null;

  const customStartup = egg.allow_custom_startup_command && canStartupCommand;
  const showStartupPicker = updatingStartup && canStartupCommand && (egg.startup_commands.length > 1 || customStartup);
  const presetValue = egg.startup_commands.some((c) => c.value === startup) ? startup : null;

  const close = () => {
    if (!submitting) onClose();
  };

  /**
   * Creates the backup through core's backup route and waits until Wings reports it finished.
   * Throws, before anything about the server changed, when it fails, takes too long or the dialog
   * goes away.
   */
  const backUp = async (): Promise<string> => {
    const backup = await createBackup(server.uuid, { name: backupName(egg.name, new Date()), ignoredFiles: [] });
    const deadline = Date.now() + BACKUP_TIMEOUT_MS;
    for (;;) {
      const { promise: tick, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, BACKUP_POLL_MS);
      await tick;
      if (!mounted.current) throw new Error('The dialog was closed, so the egg was not changed.');
      const state = await getBackup(server.uuid, backup.uuid);
      if (state.completed) {
        if (!state.isSuccessful) throw new Error('The backup failed, so the egg was not changed.');
        return backup.uuid;
      }
      if (Date.now() > deadline) {
        throw new Error(
          'The backup did not finish within an hour, so the egg was not changed. Try again once it is done.',
        );
      }
    }
  };

  const submit = async () => {
    onBusyChange(true);
    try {
      let backupUuid: string | null = null;
      if (backingUp) {
        setPhase('backup');
        backupUuid = await backUp();
      }

      setPhase('switch');
      const result = await changeEgg(server.uuid, {
        egg_uuid: egg.uuid,
        startup: updatingStartup ? startup : null,
        image,
        keep_startup: !updatingStartup,
        reinstall: reinstalling,
        truncate_directory: wiping,
        backup_uuid: backupUuid,
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
      if (mounted.current) setPhase('idle');
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
        <EggImage src={egg.banner} ratio={BANNER_RATIO} radius='md' />

        <Group wrap='nowrap' gap='sm' align='stretch'>
          {[
            { label: 'From', name: current.name, nest: current.nest_name, icon: current.icon },
            { label: 'To', name: egg.name, nest: egg.nest_name, icon: egg.icon },
          ].map((side, i) => (
            <Group key={side.label} wrap='nowrap' gap='sm' style={{ flex: 1, minWidth: 0 }}>
              {i === 1 && (
                <Text c='dimmed' aria-hidden>
                  <FontAwesomeIcon icon={faArrowRight} />
                </Text>
              )}
              <Paper withBorder radius='md' p='sm' style={{ flex: 1, minWidth: 0 }}>
                <Group wrap='nowrap' gap='sm'>
                  <Avatar
                    src={side.icon}
                    name={side.name}
                    size='md'
                    radius='md'
                    imageProps={{ referrerPolicy: 'no-referrer', draggable: false }}
                  />
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
          {egg.options.force_startup_update ? (
            <ForcedOption
              label={`Uses ${egg.name}'s startup command`}
              description="Your host doesn't allow keeping the current startup command for this switch."
            />
          ) : (
            canStartupCommand && (
              <Switch
                label={`Use ${egg.name}'s startup command`}
                description='Turn off to keep the current startup command.'
                checked={updateStartup}
                disabled={submitting}
                onChange={(e) => setUpdateStartup(e.currentTarget.checked)}
              />
            )
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

          {egg.options.force_reinstall ? (
            <ForcedOption
              label='Reinstalls the server'
              description={`Your host always runs ${egg.name}'s install script when switching to it.`}
            />
          ) : (
            canReinstall && (
              <Switch
                label='Reinstall the server'
                description={`Runs ${egg.name}'s install script after switching.`}
                checked={reinstalling}
                disabled={submitting}
                onChange={(e) => {
                  setReinstall(e.currentTarget.checked);
                  if (!e.currentTarget.checked) setWipe(false);
                }}
              />
            )
          )}

          {reinstalling &&
            (egg.options.force_truncate ? (
              <ForcedOption
                color='red'
                label='Deletes all files before reinstalling'
                description={`Your host always deletes the files when reinstalling into ${egg.name}. This cannot be undone.`}
              />
            ) : (
              <Switch
                color='red'
                label='Delete all files before reinstalling'
                description='Starts from an empty server. This cannot be undone.'
                checked={wiping}
                disabled={submitting}
                onChange={(e) => {
                  setWipe(e.currentTarget.checked);
                  setUnderstood(false);
                }}
              />
            ))}

          {egg.options.force_backup ? (
            <ForcedOption
              label='Creates a backup first'
              description={`Your host always backs up the server before switching to ${egg.name}. Nothing changes until the backup has finished successfully.`}
            />
          ) : (
            <Checkbox
              label='Create a backup first'
              description={
                backupUnavailable ??
                `Named "${backupName(egg.name, new Date())}". Nothing changes until it has finished successfully.`
              }
              checked={backingUp}
              disabled={submitting || !backupAvailable}
              onChange={(e) => setBackupChoice(e.currentTarget.checked)}
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

        {phase === 'backup' && (
          <Alert variant='light' icon={<Loader size='xs' />} title='Creating a backup'>
            The egg changes once the backup has finished. Keep this dialog open; closing the page cancels the switch,
            not the backup.
          </Alert>
        )}

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
