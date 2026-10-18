import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

type Props = {
  tournamentName: string;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Confirms the end of the tournament: results can no longer be entered or changed. */
export function FinishTournamentModal({ tournamentName, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();

  return (
    <Modal opened onClose={onCancel} title={t('tournament.rounds.finishModal.title')}>
      <Stack>
        <Text>{t('tournament.rounds.finishModal.message', { name: tournamentName })}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            {t('tournament.rounds.finishModal.cancel')}
          </Button>
          <Button onClick={onConfirm}>{t('tournament.rounds.finishModal.confirm')}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
