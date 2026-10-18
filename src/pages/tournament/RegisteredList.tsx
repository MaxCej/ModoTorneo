import { Badge, Button, Group, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { PlayerEntry, TournamentStatus } from '../../domain';

type Props = {
  /** Registered players, name asc. */
  entries: PlayerEntry[];
  status: TournamentStatus;
  onRemove: (entry: PlayerEntry) => void;
  onDrop: (entry: PlayerEntry) => void;
};

/** Right column: players in this tournament. Remove in setup, Drop while running. */
export function RegisteredList({ entries, status, onRemove, onDrop }: Props) {
  const { t } = useTranslation();
  const active = entries.filter((entry) => !entry.dropped).length;

  return (
    <Stack gap="sm">
      <Title order={2} size="h4">
        {t('tournament.registration.registered', { count: active })}
      </Title>

      {entries.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t('tournament.registration.registeredEmpty')}
        </Text>
      ) : (
        <Stack gap={4} component="ul" p={0} m={0} style={{ listStyle: 'none' }}>
          {entries.map((entry) => (
            <Group key={entry.playerId} component="li" justify="space-between" wrap="nowrap">
              <Group gap="xs" wrap="nowrap">
                <Text c={entry.dropped ? 'dimmed' : undefined}>{entry.playerName}</Text>
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
              {status === 'setup' && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="red"
                  aria-label={t('tournament.registration.removeLabel', { name: entry.playerName })}
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
          ))}
        </Stack>
      )}
    </Stack>
  );
}
