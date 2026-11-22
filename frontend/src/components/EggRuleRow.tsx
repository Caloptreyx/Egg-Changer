import { faArrowRight, faChevronDown, faChevronUp, faEdit, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Badge, Group, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { type ReactNode, useMemo, useState } from 'react';
import Button from '@/elements/buttons/Button.tsx';
import type { EggItem, EggRule } from '../api/client.ts';
import {
  DELETED_GROUP,
  type EggGroup,
  groupByNest,
  groupSummary,
  SUMMARY_NESTS,
  summaryHidesEggs,
} from '../lib/eggGroups.ts';

interface RuleSideProps {
  label: ReactNode;
  groups: EggGroup[];
  expanded: boolean;
}

/** One side of a rule: a line per nest, or every egg name grouped by nest when expanded. */
function RuleSide({ label, groups, expanded }: RuleSideProps) {
  const count = groups.reduce((total, group) => total + group.eggs.length, 0);
  const shown = expanded ? groups : groups.slice(0, SUMMARY_NESTS);

  return (
    <Stack gap={4} style={{ minWidth: 0 }}>
      <Text size='xs' c='dimmed' fw={600}>
        {label} · {count === 1 ? '1 egg' : `${count} eggs`}
      </Text>
      {shown.map((group) => {
        const nestColor = group.key === DELETED_GROUP ? 'red' : undefined;
        if (expanded) {
          return (
            <div key={group.key}>
              <Text size='sm' fw={600} c={nestColor}>
                {group.nestName}{' '}
                <Text span size='xs' c='dimmed' fw={400}>
                  {group.key === DELETED_GROUP ? group.eggs.length : `${group.eggs.length} of ${group.nestSize}`}
                </Text>
              </Text>
              <Text size='sm'>{group.eggs.map((egg) => egg.name).join(', ')}</Text>
            </div>
          );
        }
        const summary = groupSummary(group);
        return (
          <Text key={group.key} size='sm' lineClamp={2} title={`${group.nestName}: ${summary}`}>
            <Text span size='sm' fw={600} c={nestColor}>
              {group.nestName}:
            </Text>{' '}
            {summary}
          </Text>
        );
      })}
      {!expanded && groups.length > SUMMARY_NESTS && (
        <Text size='xs' c='dimmed'>
          and {groups.length - SUMMARY_NESTS} more {groups.length - SUMMARY_NESTS === 1 ? 'nest' : 'nests'}
        </Text>
      )}
    </Stack>
  );
}

interface EggRuleRowProps {
  rule: EggRule;
  eggs: EggItem[];
  /** Short labels of the options the rule enables. */
  optionBadges: string[];
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

/** A rule as a compact card: a summary of both sides, its options and actions, every egg on demand. */
export default function EggRuleRow({ rule, eggs, optionBadges, canWrite, onEdit, onDelete }: EggRuleRowProps) {
  const [expanded, setExpanded] = useState(false);
  const sources = useMemo(() => groupByNest(rule.eggs, eggs), [rule.eggs, eggs]);
  const targets = useMemo(() => groupByNest(rule.allowed_eggs, eggs), [rule.allowed_eggs, eggs]);
  const canExpand = summaryHidesEggs(sources) || summaryHidesEggs(targets);

  return (
    <Paper withBorder radius='md' p='sm'>
      <Group align='flex-start' wrap='nowrap' gap='sm'>
        <Stack gap='xs' style={{ flex: 1, minWidth: 0 }}>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='lg' verticalSpacing='xs'>
            <RuleSide label='Servers on' groups={sources} expanded={expanded} />
            <RuleSide
              label={
                <>
                  <FontAwesomeIcon icon={faArrowRight} /> Can switch to
                </>
              }
              groups={targets}
              expanded={expanded}
            />
          </SimpleGrid>

          <Group gap='xs' justify='space-between'>
            <Group gap={6}>
              {optionBadges.length === 0 ? (
                <Text size='xs' c='dimmed'>
                  No options
                </Text>
              ) : (
                optionBadges.map((badge) => (
                  <Badge key={badge} size='sm' variant='light' color='gray' tt='none'>
                    {badge}
                  </Badge>
                ))
              )}
            </Group>
            {canExpand && (
              <Button
                size='xs'
                variant='subtle'
                color='gray'
                rightSection={<FontAwesomeIcon icon={expanded ? faChevronUp : faChevronDown} />}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? 'Show less' : 'Show all eggs'}
              </Button>
            )}
          </Group>
        </Stack>

        {canWrite && (
          <Group gap='xs' wrap='nowrap' style={{ flexShrink: 0 }}>
            <Button size='xs' variant='light' color='gray' aria-label='Edit rule' onClick={onEdit}>
              <FontAwesomeIcon icon={faEdit} />
            </Button>
            <Button size='xs' variant='subtle' color='red' aria-label='Delete rule' onClick={onDelete}>
              <FontAwesomeIcon icon={faTrash} />
            </Button>
          </Group>
        )}
      </Group>
    </Paper>
  );
}
