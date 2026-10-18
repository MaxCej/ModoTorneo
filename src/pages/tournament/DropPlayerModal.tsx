import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

type Props = {
  playerName: string;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Confirms a drop: it affects every later pairing, and rollback arrives only in SPEC 07. */
export function DropPlayerModal({ playerName, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();

  return (
    <Modal opened onClose={onCancel} title={t('tournament.registration.dropModal.title')}>
      <Stack>
        <Text>{t('tournament.registration.dropModal.message', { name: playerName })}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            {t('tournament.registration.dropModal.cancel')}
          </Button>
          <Button color="red" onClick={onConfirm}>
            {t('tournament.registration.dropModal.confirm')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
