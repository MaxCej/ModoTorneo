import { Badge, Group, Table } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { Standing } from '../../domain';

/** Read-only swiss standings after `round`, one row per `Standing`, in order. */
export function StandingsTable({ rows, round }: { rows: Standing[]; round: number }) {
  const { t } = useTranslation();
  const pct = (value: number) =>
    t('tournament.standings.percent', { value: (value * 100).toFixed(2) });

  return (
    <Table.ScrollContainer minWidth={560}>
      <Table withTableBorder fz="sm" aria-label={t('tournament.standings.tableLabel', { round })}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('tournament.standings.rank')}</Table.Th>
            <Table.Th>{t('tournament.standings.player')}</Table.Th>
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
                  {row.playerName}
                  {row.dropped && (
                    <Badge size="sm" variant="light" color="gray">
                      {t('tournament.standings.dropped')}
                    </Badge>
                  )}
                </Group>
              </Table.Td>
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
