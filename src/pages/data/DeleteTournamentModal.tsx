import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { TournamentSummary } from '../../storage';

type Props = {
  tournament: TournamentSummary;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Confirms a hard delete. Players are kept. */
export function DeleteTournamentModal({ tournament, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();

  return (
    <Modal opened onClose={onCancel} title={t('data.deleteModal.title')}>
      <Stack>
        <Text>{t('data.deleteModal.message', { name: tournament.name })}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            {t('data.deleteModal.cancel')}
          </Button>
          <Button color="red" onClick={onConfirm}>
            {t('data.deleteModal.confirm')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
