import { faArrowRightArrowLeft } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Button from '@/elements/buttons/Button.tsx';
import Avatar from '@/elements/data-display/Avatar.tsx';
import Badge from '@/elements/data-display/Badge.tsx';
import Card from '@/elements/data-display/Card.tsx';
import Box from '@/elements/layout/Box.tsx';
import Group from '@/elements/layout/Group.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import Text from '@/elements/typography/Text.tsx';
import type { TargetEgg } from '../api/client.ts';

interface EggCardProps {
  egg: TargetEgg;
  disabled: boolean;
  /** Shown instead of allowing the switch, e.g. when a core permission is missing. */
  blocker: string | null;
  onSelect: () => void;
}

export default function EggCard({ egg, disabled, blocker, onSelect }: EggCardProps) {
  const { options } = egg;

  return (
    <Card padding='lg' h='100%'>
      <Group wrap='nowrap' gap='sm' align='flex-start'>
        <Avatar name={egg.name} size='md' radius='md' />
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Text fw={600} lineClamp={2} style={{ overflowWrap: 'anywhere' }}>
            {egg.name}
          </Text>
          <Badge variant='light' color='gray' size='sm' style={{ maxWidth: '100%' }}>
            {egg.nest_name}
          </Badge>
        </Stack>
      </Group>

      <Text size='sm' c='dimmed' lineClamp={3} mt='sm' style={{ minHeight: '4.5em' }}>
        {egg.description || 'No description.'}
      </Text>

      <Group gap={6} mt='sm' mih={22}>
        {options.force_reinstall && (
          <Badge size='sm' variant='light' color={options.force_truncate ? 'red' : 'yellow'}>
            {options.force_truncate ? 'Wipes files' : 'Reinstalls'}
          </Badge>
        )}
        {!options.force_reinstall && options.force_truncate && (
          <Badge size='sm' variant='light' color='red'>
            Wipes files on reinstall
          </Badge>
        )}
        {options.force_startup_update && (
          <Badge size='sm' variant='light' color='gray'>
            New startup command
          </Badge>
        )}
        {egg.deployment_allocations > 0 && (
          <Badge size='sm' variant='light' color='gray'>
            +{egg.deployment_allocations} port{egg.deployment_allocations === 1 ? '' : 's'}
          </Badge>
        )}
      </Group>

      <Box mt='auto' pt='md'>
        {blocker && (
          <Text size='xs' c='dimmed' mb='xs'>
            {blocker}
          </Text>
        )}
        <Button
          fullWidth
          variant='light'
          leftSection={<FontAwesomeIcon icon={faArrowRightArrowLeft} />}
          disabled={disabled || !!blocker}
          onClick={onSelect}
          aria-label={`Switch to ${egg.name}`}
        >
          Switch to this egg
        </Button>
      </Box>
    </Card>
  );
}
