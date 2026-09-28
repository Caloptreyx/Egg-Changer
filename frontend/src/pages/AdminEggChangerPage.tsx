import { faArrowRight, faEdit, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Badge, Card, Group, SimpleGrid, Stack, Switch, Table, Text, Title } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { httpErrorToHuman } from '@/api/axios.ts';
import AlertError from '@/elements/alerts/AlertError.tsx';
import Button from '@/elements/buttons/Button.tsx';
import Spinner from '@/elements/feedback/Spinner.tsx';
import ConfirmationModal from '@/elements/modals/ConfirmationModal.tsx';
import { Modal, ModalFooter } from '@/elements/modals/Modal.tsx';
import { useAdminCan } from '@/plugins/usePermissions.ts';
import { useToast } from '@/providers/ToastProvider.tsx';
import {
  type AdminSettingsResponse,
  createEggRule,
  deleteEggRule,
  type EggRule,
  getAdminSettings,
  updateAdminSettings,
  updateEggRule,
} from '../api/client.ts';
import EggTreePicker from '../components/EggTreePicker.tsx';

export default function AdminEggChangerPage() {
  const { addToast } = useToast();
  const canWrite = useAdminCan('extensions.eggchanger.write');

  const [settings, setSettings] = useState<AdminSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [savingDeployment, setSavingDeployment] = useState(false);

  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<EggRule | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<EggRule | null>(null);
  const [submittingRule, setSubmittingRule] = useState(false);
  const [sourceEggs, setSourceEggs] = useState<string[]>([]);
  const [targetEggs, setTargetEggs] = useState<string[]>([]);

  const load = async () => {
    try {
      setLoading(true);
      setLoadError('');
      setSettings(await getAdminSettings());
    } catch (err) {
      setLoadError(httpErrorToHuman(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const eggNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const egg of settings?.eggs ?? []) {
      map.set(egg.uuid, `${egg.name} (${egg.nest_name})`);
    }
    return map;
  }, [settings?.eggs]);

  const toggleDeployment = async (enabled: boolean) => {
    try {
      setSavingDeployment(true);
      await updateAdminSettings({ apply_allocation_deployment: enabled });
      setSettings((prev) => (prev ? { ...prev, apply_allocation_deployment: enabled } : prev));
      addToast('Settings saved.', 'success');
    } catch (err) {
      addToast(httpErrorToHuman(err), 'error');
    } finally {
      setSavingDeployment(false);
    }
  };

  const openRuleModal = (rule: EggRule | null) => {
    setEditingRule(rule);
    setSourceEggs(rule?.eggs ?? []);
    setTargetEggs(rule?.allowed_eggs ?? []);
    setRuleModalOpen(true);
  };

  const saveRule = async () => {
    try {
      setSubmittingRule(true);
      const payload = { eggs: sourceEggs, allowed_eggs: targetEggs };
      if (editingRule) {
        await updateEggRule(editingRule.id, payload);
        addToast('Egg rule updated.', 'success');
      } else {
        await createEggRule(payload);
        addToast('Egg rule created.', 'success');
      }
      setRuleModalOpen(false);
      await load();
    } catch (err) {
      addToast(httpErrorToHuman(err), 'error');
    } finally {
      setSubmittingRule(false);
    }
  };

  const removeRule = async () => {
    if (!ruleToDelete) return;
    try {
      await deleteEggRule(ruleToDelete.id);
      addToast('Egg rule deleted.', 'success');
      setRuleToDelete(null);
      await load();
    } catch (err) {
      addToast(httpErrorToHuman(err), 'error');
    }
  };

  const eggBadges = (uuids: string[], color: string) => (
    <Group gap='xs'>
      {uuids.map((uuid) => (
        <Badge key={uuid} size='sm' variant='light' color={eggNames.has(uuid) ? color : 'gray'}>
          {eggNames.get(uuid) ?? `Deleted egg ${uuid.slice(0, 8)}`}
        </Badge>
      ))}
    </Group>
  );

  const header = (
    <div>
      <Title order={3} fw={700}>
        Egg Changer
      </Title>
      <Text size='sm' c='dimmed'>
        Decide which eggs servers may switch between. Server owners and subusers with the eggchanger.change permission
        switch from the server settings page.
      </Text>
    </div>
  );

  if (loading && !settings) {
    return (
      <div className='flex justify-center items-center py-24'>
        <Spinner />
      </div>
    );
  }

  if (!settings) {
    // never render the editable view with placeholder values: saving it would overwrite real settings
    return (
      <Stack gap='lg'>
        {header}
        {loadError && <AlertError error={loadError} setError={setLoadError} />}
        <Group>
          <Button onClick={load}>Retry</Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap='lg'>
      {header}

      <Card padding='lg' radius='md' withBorder>
        <Stack gap='md'>
          <Title order={4} fw={600}>
            Allocations
          </Title>
          <Switch
            disabled={!canWrite || savingDeployment}
            label="Apply the new egg's allocation deployment rules"
            description="When a server switches, it keeps its primary allocation and gets any additional allocations the new egg's configuration asks for (for example a query or Bedrock port). Allocations the server already has are reused where they fit, and the ports are written to the egg's variables."
            checked={settings.apply_allocation_deployment}
            onChange={(e) => toggleDeployment(e.currentTarget.checked)}
          />
        </Stack>
      </Card>

      <Card padding='lg' radius='md' withBorder>
        <Stack gap='md'>
          <Group justify='space-between' align='center'>
            <div>
              <Title order={4} fw={600}>
                Egg Rules
              </Title>
              <Text size='xs' c='dimmed'>
                A server can switch to every target egg of each rule its current egg is a source of. Servers without a
                matching rule cannot switch.
              </Text>
            </div>
            {canWrite && (
              <Button onClick={() => openRuleModal(null)} leftSection={<FontAwesomeIcon icon={faPlus} />}>
                Add Egg Rule
              </Button>
            )}
          </Group>

          {settings.egg_rules.length === 0 ? (
            <Text c='dimmed' size='sm' ta='center' py='lg'>
              No egg rules yet, so no server can switch eggs.
            </Text>
          ) : (
            <Table.ScrollContainer minWidth={600}>
              <Table verticalSpacing='sm' striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Servers on</Table.Th>
                    <Table.Th w={32} />
                    <Table.Th>Can switch to</Table.Th>
                    {canWrite && <Table.Th w={110}>Actions</Table.Th>}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {settings.egg_rules.map((rule) => (
                    <Table.Tr key={rule.id}>
                      <Table.Td>{eggBadges(rule.eggs, 'blue')}</Table.Td>
                      <Table.Td>
                        <FontAwesomeIcon icon={faArrowRight} />
                      </Table.Td>
                      <Table.Td>{eggBadges(rule.allowed_eggs, 'teal')}</Table.Td>
                      {canWrite && (
                        <Table.Td>
                          <Group gap='xs' wrap='nowrap'>
                            <Button size='xs' variant='light' color='gray' onClick={() => openRuleModal(rule)}>
                              <FontAwesomeIcon icon={faEdit} />
                            </Button>
                            <Button size='xs' variant='subtle' color='red' onClick={() => setRuleToDelete(rule)}>
                              <FontAwesomeIcon icon={faTrash} />
                            </Button>
                          </Group>
                        </Table.Td>
                      )}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Stack>
      </Card>

      <Modal
        opened={ruleModalOpen}
        onClose={() => setRuleModalOpen(false)}
        title={editingRule ? 'Edit Egg Rule' : 'New Egg Rule'}
        size='xl'
      >
        <Stack gap='md'>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing='lg'>
            <EggTreePicker
              label='Servers on'
              description='Servers using any of these eggs get this rule'
              eggs={settings.eggs}
              value={sourceEggs}
              onChange={setSourceEggs}
            />
            <EggTreePicker
              label='Can switch to'
              description='Eggs those servers may switch to'
              eggs={settings.eggs}
              value={targetEggs}
              onChange={setTargetEggs}
              actions={
                <Button
                  size='xs'
                  variant='light'
                  disabled={sourceEggs.length === 0}
                  onClick={() => setTargetEggs(sourceEggs)}
                >
                  Same as source eggs
                </Button>
              }
            />
          </SimpleGrid>

          <Text size='xs' c='dimmed'>
            Selecting the same eggs on both sides lets servers switch freely within that group.
          </Text>

          <ModalFooter>
            <Button variant='default' onClick={() => setRuleModalOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={submittingRule}
              disabled={sourceEggs.length === 0 || targetEggs.length === 0}
              onClick={saveRule}
            >
              Save Rule
            </Button>
          </ModalFooter>
        </Stack>
      </Modal>

      <ConfirmationModal
        opened={!!ruleToDelete}
        onClose={() => setRuleToDelete(null)}
        title='Delete Egg Rule'
        confirm='Delete Rule'
        confirmColor='red'
        onConfirmed={removeRule}
      >
        <Text size='sm'>Servers on the rule's eggs will no longer be able to switch to its target eggs.</Text>
      </ConfirmationModal>
    </Stack>
  );
}
