import { Table } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { SWISS_ROUNDS_TABLE } from '../../domain';

/** The recommended swiss rounds table. The row for `activePlayers` is highlighted. */
export function RoundsTable({ activePlayers }: { activePlayers: number }) {
  const { t } = useTranslation();

  return (
    <Table withTableBorder striped={false} fz="sm">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{t('tournament.roundsTable.players')}</Table.Th>
          <Table.Th>{t('tournament.roundsTable.rounds')}</Table.Th>
          <Table.Th>{t('tournament.roundsTable.roundsTop8')}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {SWISS_ROUNDS_TABLE.map((row) => {
          const current =
            activePlayers >= row.min && (row.max === null || activePlayers <= row.max);
          let range = t('tournament.roundsTable.rangeOpen', { min: row.min });
          if (row.max === row.min) {
            range = String(row.min);
          } else if (row.max !== null) {
            range = t('tournament.roundsTable.range', { min: row.min, max: row.max });
          }
          return (
            <Table.Tr
              key={row.min}
              aria-current={current ? 'true' : undefined}
              bg={current ? 'var(--mantine-primary-color-light)' : undefined}
              fw={current ? 700 : undefined}
            >
              <Table.Td>{range}</Table.Td>
              <Table.Td>{row.rounds}</Table.Td>
              <Table.Td>{row.roundsTop8 ?? t('tournament.roundsTable.none')}</Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}
