import { faTrash, faUpload } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { AspectRatio, Center, FileButton, SimpleGrid } from '@mantine/core';
import { useEffect, useState } from 'react';
import { httpErrorToHuman } from '@/api/axios.ts';
import Button from '@/elements/buttons/Button.tsx';
import TextInput from '@/elements/input/TextInput.tsx';
import Box from '@/elements/layout/Box.tsx';
import Group from '@/elements/layout/Group.tsx';
import Paper from '@/elements/layout/Paper.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import { Modal, ModalFooter } from '@/elements/modals/Modal.tsx';
import Text from '@/elements/typography/Text.tsx';
import { useAdminCan } from '@/plugins/usePermissions.ts';
import { useToast } from '@/providers/ToastProvider.tsx';
import { type EggAppearance, type EggItem, updateEggAppearance, uploadImageAsset } from '../api/client.ts';
import {
  BANNER_RATIO,
  imageUrlOrNull,
  imageUrlProblem,
  MAX_UPLOAD_BYTES,
  UPLOAD_ACCEPT,
  uploadFileName,
} from '../lib/images.ts';
import EggCard from './EggCard.tsx';
import EggImage from './EggImage.tsx';

type Kind = 'icon' | 'banner';

const FIELDS: Record<Kind, { label: string; description: string; ratio: number; previewWidth?: number }> = {
  icon: {
    label: 'Icon',
    description: 'Square, at least 128 × 128. Shown on the card, in the switch dialog and as the current egg.',
    ratio: 1,
    previewWidth: 96,
  },
  banner: {
    label: 'Banner',
    description: 'Wide, shown at 3:1 (for example 1200 × 400) and cropped to fit. Shown on top of the card and dialog.',
    ratio: BANNER_RATIO,
  },
};

function LoadFailed({ ratio }: { ratio: number }) {
  return (
    <Paper withBorder radius='md'>
      <AspectRatio ratio={ratio}>
        <Center p='xs'>
          <Text size='xs' c='dimmed' ta='center'>
            Couldn't load this image
          </Text>
        </Center>
      </AspectRatio>
    </Paper>
  );
}

interface ImageFieldProps {
  kind: Kind;
  eggUuid: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onUploadingChange: (uploading: boolean) => void;
}

function ImageField({ kind, eggUuid, value, disabled, onChange, onUploadingChange }: ImageFieldProps) {
  const { addToast } = useToast();
  const canUpload = useAdminCan('assets.upload');
  const [uploading, setUploading] = useState(false);
  const field = FIELDS[kind];
  const problem = imageUrlProblem(value);
  const preview = problem ? null : imageUrlOrNull(value);

  const upload = async (file: File | null) => {
    if (!file) return;
    const name = uploadFileName(eggUuid, kind, file.name, Date.now());
    if (!name) {
      addToast('Upload a PNG, JPEG, GIF, WebP or AVIF image.', 'error');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      addToast('Images can be at most 5 MB.', 'error');
      return;
    }

    setUploading(true);
    onUploadingChange(true);
    try {
      onChange(await uploadImageAsset(file, name));
    } catch (err) {
      addToast(httpErrorToHuman(err), 'error');
    } finally {
      setUploading(false);
      onUploadingChange(false);
    }
  };

  return (
    <Stack gap='xs'>
      <TextInput
        label={field.label}
        description={field.description}
        placeholder='https://'
        value={value}
        error={problem}
        disabled={disabled || uploading}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
      <Group gap='xs'>
        {canUpload && (
          <FileButton onChange={upload} accept={UPLOAD_ACCEPT} disabled={disabled || uploading}>
            {(props) => (
              <Button
                {...props}
                size='xs'
                variant='light'
                loading={uploading}
                leftSection={<FontAwesomeIcon icon={faUpload} />}
              >
                Upload
              </Button>
            )}
          </FileButton>
        )}
        <Button
          size='xs'
          variant='subtle'
          color='red'
          disabled={disabled || uploading || value === ''}
          leftSection={<FontAwesomeIcon icon={faTrash} />}
          onClick={() => onChange('')}
        >
          Remove
        </Button>
      </Group>
      {preview && (
        <Box w={field.previewWidth}>
          <EggImage
            key={preview}
            src={preview}
            ratio={field.ratio}
            radius='md'
            fallback={<LoadFailed ratio={field.ratio} />}
          />
        </Box>
      )}
    </Stack>
  );
}

interface EggAppearanceModalProps {
  /** The egg being edited; null keeps the modal closed. */
  egg: EggItem | null;
  value: EggAppearance;
  onClose: () => void;
  onSaved: (eggUuid: string, appearance: EggAppearance) => void;
}

/** Icon and banner of one egg, with previews and an optional upload to the panel's assets. */
export default function EggAppearanceModal({ egg, value, onClose, onSaved }: EggAppearanceModalProps) {
  const { addToast } = useToast();
  const canUpload = useAdminCan('assets.upload');
  const [icon, setIcon] = useState('');
  const [banner, setBanner] = useState('');
  const [uploads, setUploads] = useState(0);
  const [saving, setSaving] = useState(false);

  // every opened egg starts from its saved pictures
  useEffect(() => {
    setIcon(value.icon ?? '');
    setBanner(value.banner ?? '');
  }, [egg?.uuid, value.icon, value.banner]);

  const uploading = (active: boolean) => setUploads((count) => count + (active ? 1 : -1));
  const invalid = imageUrlProblem(icon) !== null || imageUrlProblem(banner) !== null;

  const save = async () => {
    if (!egg) return;
    try {
      setSaving(true);
      const saved = await updateEggAppearance(egg.uuid, {
        icon: imageUrlOrNull(icon),
        banner: imageUrlOrNull(banner),
      });
      onSaved(egg.uuid, saved);
      addToast(`Saved the pictures of ${egg.name}.`, 'success');
      onClose();
    } catch (err) {
      addToast(httpErrorToHuman(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (!saving && uploads === 0) onClose();
  };

  return (
    <Modal opened={!!egg} onClose={close} title={egg ? `Icon and banner of ${egg.name}` : ''} size='xl'>
      {egg && (
        <Stack gap='md'>
          <Text size='sm' c='dimmed'>
            {canUpload
              ? 'Paste an https image URL or upload a picture; uploads go to Admin → Assets, folder egg-changer.'
              : 'Paste an https image URL. Uploading needs the Assets upload permission.'}{' '}
            Leave a field empty for the look without a picture.
          </Text>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing='lg'>
            <Stack gap='lg'>
              <ImageField
                kind='icon'
                eggUuid={egg.uuid}
                value={icon}
                disabled={saving}
                onChange={setIcon}
                onUploadingChange={uploading}
              />
              <ImageField
                kind='banner'
                eggUuid={egg.uuid}
                value={banner}
                disabled={saving}
                onChange={setBanner}
                onUploadingChange={uploading}
              />
            </Stack>

            <Stack gap='xs'>
              <Text size='sm' fw={500}>
                Card preview
              </Text>
              <Box maw={360} w='100%'>
                <EggCard
                  egg={{
                    uuid: egg.uuid,
                    name: egg.name,
                    description: "The egg's description.",
                    nest_uuid: egg.nest_uuid,
                    nest_name: egg.nest_name,
                    startup_commands: [],
                    docker_images: [],
                    allow_custom_startup_command: false,
                    deployment_allocations: 0,
                    options: {
                      force_startup_update: false,
                      force_reinstall: false,
                      force_truncate: false,
                      reassign_allocations: false,
                      force_backup: false,
                    },
                    icon: imageUrlProblem(icon) ? null : imageUrlOrNull(icon),
                    banner: imageUrlProblem(banner) ? null : imageUrlOrNull(banner),
                  }}
                  disabled
                  blocker={null}
                  onSelect={() => {}}
                />
              </Box>
            </Stack>
          </SimpleGrid>

          <ModalFooter>
            <Button variant='default' onClick={close} disabled={saving || uploads > 0}>
              Cancel
            </Button>
            <Button loading={saving} disabled={invalid || uploads > 0} onClick={save}>
              Save
            </Button>
          </ModalFooter>
        </Stack>
      )}
    </Modal>
  );
}
