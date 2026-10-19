import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

type Props = {
  round: number;
  /** Results and swaps of the round that the redo voids. */
  voidedResults: number;
  voidedSwaps: number;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Confirms re-pairing the open swiss round. */
export function RedoPairingsModal({
  round,
  voidedResults,
  voidedSwaps,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation();

  return (
    <Modal opened onClose={onCancel} title={t('tournament.rounds.redoModal.title', { round })}>
      <Stack>
        {(voidedResults > 0 || voidedSwaps > 0) && (
          <Text>
            {t('tournament.rounds.redoModal.undoes', {
              results: t('tournament.rounds.redoModal.results', { count: voidedResults }),
              swaps: t('tournament.rounds.redoModal.swaps', { count: voidedSwaps }),
            })}
          </Text>
        )}
        <Text>{t('tournament.rounds.redoModal.kept')}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            {t('tournament.rounds.redoModal.cancel')}
          </Button>
          <Button onClick={onConfirm}>{t('tournament.rounds.redoModal.confirm')}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
