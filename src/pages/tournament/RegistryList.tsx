import { Alert, Button, Group, Stack, Text, TextInput, Title, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Player } from '../../domain';
import type { StorageError } from '../../storage';
import { PlayerName } from '../players/PlayerName';
import { NameEntry } from './NameEntry';

type Props = {
  /** Registry players not registered in this tournament, name asc. */
  players: Player[];
  loadError: StorageError | null;
  readOnly: boolean;
  existingNames: readonly string[];
  onRegister: (player: Player) => void;
  /** Adds a player to the registry and registers them. Returns an error message or null. */
  onAddNew: (name: string) => Promise<string | null>;
};

/** Left column: the global registry. Click a row, or type a filter and press Enter. */
export function RegistryList({
  players,
  loadError,
  readOnly,
  existingNames,
  onRegister,
  onAddNew,
}: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLocaleLowerCase();
  const listed = needle
    ? players.filter((player) => player.name.toLocaleLowerCase().includes(needle))
    : players;

  return (
    <Stack gap="sm">
      <Title order={2} size="h4">
        {t('tournament.registration.registry')}
      </Title>

      {loadError && (
        <Alert color="red">
          {t('tournament.registration.registryFailed', {
            code: loadError.code,
            message: loadError.message,
          })}
        </Alert>
      )}

      {!readOnly && (
        <NameEntry
          label={t('tournament.registration.newPlayer')}
          existingNames={existingNames}
          onAdd={onAddNew}
        />
      )}

      {!readOnly && (
        <TextInput
          label={t('tournament.registration.filter')}
          value={filter}
          onChange={(event) => setFilter(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && listed.length > 0) {
              event.preventDefault();
              onRegister(listed[0]);
              setFilter('');
            }
          }}
        />
      )}

      {listed.length === 0 ? (
        <Text c="dimmed" size="sm">
          {needle
            ? t('tournament.registration.noMatch')
            : t('tournament.registration.registryEmpty')}
        </Text>
      ) : (
        <Stack gap={4} component="ul" p={0} m={0} style={{ listStyle: 'none' }}>
          {listed.map((player) => (
            <Group key={player.id} component="li" justify="space-between" wrap="nowrap">
              {readOnly ? (
                <Text>
                  <PlayerName playerId={player.id} name={player.name} guest={false} />
                </Text>
              ) : (
                <>
                  <UnstyledButton onClick={() => onRegister(player)} style={{ flex: 1 }}>
                    {player.name}
                  </UnstyledButton>
                  <Button
                    size="compact-xs"
                    variant="light"
                    aria-label={t('tournament.registration.addLabel', { name: player.name })}
                    onClick={() => onRegister(player)}
                  >
                    {t('tournament.registration.add')}
                  </Button>
                </>
              )}
            </Group>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
