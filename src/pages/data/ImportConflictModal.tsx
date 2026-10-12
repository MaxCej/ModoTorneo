import { Button, Group, Modal, SegmentedControl, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Uuid } from '../../domain';
import type { ConflictChoice, ImportPlanItem } from '../../storage';

type Props = {
  conflicts: ImportPlanItem[]; // plan items with outcome 'conflict'
  onCancel: () => void;
  onConfirm: (choices: Record<Uuid, ConflictChoice>) => void;
};

/** One choice per diverged tournament. Default skip, so a careless click loses nothing. */
export function ImportConflictModal({ conflicts, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const [choices, setChoices] = useState<Record<Uuid, ConflictChoice>>({});
  const options = [
    { value: 'skip', label: t('data.conflicts.skip') },
    { value: 'overwrite', label: t('data.conflicts.overwrite') },
    { value: 'copy', label: t('data.conflicts.copy') },
  ];

  return (
    <Modal opened onClose={onCancel} title={t('data.conflicts.title')} size="lg">
      <Stack>
        <Text size="sm">{t('data.conflicts.intro')}</Text>
        {conflicts.map((item) => (
          <Stack key={item.doc.id} gap="xs" role="group" aria-label={item.state.name}>
            <Text fw={600}>{item.state.name}</Text>
            <Text size="sm">
              {t('data.conflicts.eventCounts', {
                local: item.local?.eventCount ?? 0,
                imported: item.doc.events.length,
              })}
            </Text>
            <SegmentedControl
              data={options}
              value={choices[item.doc.id] ?? 'skip'}
              onChange={(value) =>
                setChoices((current) => ({ ...current, [item.doc.id]: value as ConflictChoice }))
              }
            />
          </Stack>
        ))}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            {t('data.conflicts.cancel')}
          </Button>
          <Button onClick={() => onConfirm(choices)}>{t('data.conflicts.import')}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
