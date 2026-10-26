import { Alert, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Player, Result } from '../../domain';
import type { StorageError } from '../../storage';

type Props = {
  player: Player;
  /** The other registry players' names, compared trimmed and case-insensitive. */
  otherNames: readonly string[];
  /** Saves the new name (`playersStore.renamePlayer`). */
  onSave: (name: string) => Promise<Result<Player, StorageError>>;
  onClose: () => void;
};

/**
 * Renames a registry player. Another player's name needs a second click ("Rename anyway"),
 * since names may legitimately repeat (SPEC 04). Past tournaments keep their name snapshot.
 */
export function RenamePlayerModal({ player, otherNames, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState(player.name);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [error, setError] = useState<StorageError | null>(null);
  const [saving, setSaving] = useState(false);

  const name = value.trim();
  const unchanged = name === '' || name === player.name;

  async function save() {
    if (unchanged || saving) {
      return;
    }
    const lower = name.toLocaleLowerCase();
    const exists = otherNames.some((other) => other.trim().toLocaleLowerCase() === lower);
    if (exists && duplicate === null) {
      setDuplicate(name);
      return;
    }
    setSaving(true);
    const result = await onSave(name);
    setSaving(false);
    if (result.ok) {
      onClose();
    } else {
      setError(result.error);
    }
  }

  return (
    <Modal opened onClose={onClose} title={t('players.rename.title')}>
      <Stack>
        <TextInput
          label={t('players.rename.name')}
          value={value}
          maxLength={100}
          description={t('players.rename.note')}
          data-autofocus
          onChange={(event) => {
            // Editing the text clears the warning and the last error.
            setValue(event.currentTarget.value);
            setDuplicate(null);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void save();
            }
          }}
        />
        {duplicate !== null && (
          <Text size="sm" c="orange.8" role="status">
            {t('players.rename.duplicate', { name: duplicate })}
          </Text>
        )}
        {error !== null && (
          <Alert color="red">
            {t('players.rename.failed', { code: error.code, message: error.message })}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('players.rename.cancel')}
          </Button>
          <Button
            color={duplicate === null ? undefined : 'orange'}
            disabled={unchanged}
            loading={saving}
            onClick={() => void save()}
          >
            {duplicate === null ? t('players.rename.save') : t('players.rename.saveAnyway')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
