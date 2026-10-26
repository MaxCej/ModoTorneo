import { Badge, Group, Table } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { Deck, Standing, Uuid } from '../../domain';
import { PlayerName } from '../players/PlayerName';

type Props = {
  rows: Standing[];
  round: number;
  /** Whether a player is a guest; guests' names are not profile links. */
  isGuest: (playerId: Uuid) => boolean;
  /** The player's deck in this tournament. */
  deckOf: (playerId: Uuid) => Deck | null;
};

/** Read-only swiss standings after `round`, one row per `Standing`, in order. */
export function StandingsTable({ rows, round, isGuest, deckOf }: Props) {
  const { t } = useTranslation();
  const pct = (value: number) =>
    t('tournament.standings.percent', { value: (value * 100).toFixed(2) });

  return (
    <Table.ScrollContainer minWidth={640}>
      <Table withTableBorder fz="sm" aria-label={t('tournament.standings.tableLabel', { round })}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('tournament.standings.rank')}</Table.Th>
            <Table.Th>{t('tournament.standings.player')}</Table.Th>
            <Table.Th>{t('tournament.deck.column')}</Table.Th>
            <Table.Th>{t('tournament.standings.matchPoints')}</Table.Th>
            <Table.Th>{t('tournament.standings.record')}</Table.Th>
            <Table.Th>{t('tournament.standings.omw')}</Table.Th>
            <Table.Th>{t('tournament.standings.gw')}</Table.Th>
            <Table.Th>{t('tournament.standings.ogw')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => (
            <Table.Tr key={row.playerId}>
              <Table.Td>{row.rank}</Table.Td>
              <Table.Td>
                <Group gap="xs" wrap="nowrap">
                  <PlayerName
                    playerId={row.playerId}
                    name={row.playerName}
                    guest={isGuest(row.playerId)}
                  />
                  {row.dropped && (
                    <Badge size="sm" variant="light" color="gray">
                      {t('tournament.standings.dropped')}
                    </Badge>
                  )}
                </Group>
              </Table.Td>
              <Table.Td>{deckOf(row.playerId)?.archetype ?? t('tournament.deck.none')}</Table.Td>
              <Table.Td>{row.matchPoints}</Table.Td>
              <Table.Td>
                {t('tournament.standings.recordValue', {
                  wins: row.wins,
                  losses: row.losses,
                  draws: row.draws,
                })}
              </Table.Td>
              <Table.Td>{pct(row.opponentMatchWinPct)}</Table.Td>
              <Table.Td>{pct(row.gameWinPct)}</Table.Td>
              <Table.Td>{pct(row.opponentGameWinPct)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
