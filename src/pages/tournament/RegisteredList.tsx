import { Badge, Button, Group, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { PlayerEntry, TournamentStatus } from '../../domain';
import { PlayerName } from '../players/PlayerName';
import { Archetype } from './Archetype';
import { NameEntry } from './NameEntry';

type Props = {
  /** Registered players, name asc. */
  entries: PlayerEntry[];
  status: TournamentStatus;
  existingNames: readonly string[];
  /** Registers a guest (never saved to the registry). Returns an error message or null. */
  onAddGuest: (name: string) => string | null;
  onRemove: (entry: PlayerEntry) => void;
  onDrop: (entry: PlayerEntry) => void;
  /** Opens the deck modal. Every status, dropped players included. */
  onDeck: (entry: PlayerEntry) => void;
};

/** Right column: players in this tournament. Deck always, Remove in setup, Drop while running. */
export function RegisteredList({
  entries,
  status,
  existingNames,
  onAddGuest,
  onRemove,
  onDrop,
  onDeck,
}: Props) {
  const { t } = useTranslation();
  const active = entries.filter((entry) => !entry.dropped).length;

  return (
    <Stack gap="sm">
      <Title order={2} size="h4">
        {t('tournament.registration.registered', { count: active })}
      </Title>

      {(status === 'setup' || status === 'running') && (
        <NameEntry
          label={t('tournament.registration.addGuest')}
          existingNames={existingNames}
          onAdd={onAddGuest}
        />
      )}

      {entries.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t('tournament.registration.registeredEmpty')}
        </Text>
      ) : (
        <Stack gap={4} component="ul" p={0} m={0} style={{ listStyle: 'none' }}>
          {entries.map((entry) => (
            <Group key={entry.playerId} component="li" justify="space-between" wrap="nowrap">
              <Stack gap={0}>
                <Group gap="xs" wrap="nowrap">
                  <Text c={entry.dropped ? 'dimmed' : undefined}>
                    <PlayerName
                      playerId={entry.playerId}
                      name={entry.playerName}
                      guest={entry.guest}
                    />
                  </Text>
                  {entry.guest && (
                    <Badge size="sm" variant="light" color="grape">
                      {t('tournament.registration.guest')}
                    </Badge>
                  )}
                  {entry.dropped && (
                    <Badge size="sm" variant="light" color="gray">
                      {t('tournament.registration.dropped')}
                    </Badge>
                  )}
                </Group>
                <Archetype deck={entry.deck} />
              </Stack>
              <Group gap={4} wrap="nowrap">
                <Button
                  size="compact-xs"
                  variant="subtle"
                  aria-label={t('tournament.deck.buttonLabel', { name: entry.playerName })}
                  onClick={() => onDeck(entry)}
                >
                  {t('tournament.deck.button')}
                </Button>
                {status === 'setup' && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    aria-label={t('tournament.registration.removeLabel', {
                      name: entry.playerName,
                    })}
                    onClick={() => onRemove(entry)}
                  >
                    {t('tournament.registration.remove')}
                  </Button>
                )}
                {status === 'running' && !entry.dropped && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    aria-label={t('tournament.registration.dropLabel', { name: entry.playerName })}
                    onClick={() => onDrop(entry)}
                  >
                    {t('tournament.registration.drop')}
                  </Button>
                )}
              </Group>
            </Group>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
