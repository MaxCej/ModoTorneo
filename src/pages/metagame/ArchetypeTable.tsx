import { Table, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ArchetypeStats } from '../../domain';
import { useStatsFormat } from '../players/format';

const COLUMNS = [
  'archetype',
  'players',
  'share',
  'record',
  'matchWinRate',
  'gameWinRate',
  'topCut',
] as const;
type Column = (typeof COLUMNS)[number];
type Sort = { column: Column; direction: 'ascending' | 'descending' };

type Row = { stats: ArchetypeStats; order: number };

const collator = new Intl.Collator('en');

/** Negative when `a` comes first in ascending order. `null` rates are handled by the caller. */
function compareColumn(column: Column, a: ArchetypeStats, b: ArchetypeStats): number {
  switch (column) {
    case 'archetype':
      return collator.compare(a.archetype ?? '', b.archetype ?? '');
    case 'players':
    case 'share':
      return a.players - b.players;
    case 'record': {
      const played = ({ matches: m }: ArchetypeStats) => m.wins + m.losses + m.draws;
      return played(a) - played(b);
    }
    case 'matchWinRate':
      return a.matchWinRate! - b.matchWinRate!;
    case 'gameWinRate':
      return a.gameWinRate! - b.gameWinRate!;
    case 'topCut':
      return a.topCut - b.topCut;
  }
}

function isNull(column: Column, stats: ArchetypeStats): boolean {
  return (
    (column === 'matchWinRate' && stats.matchWinRate === null) ||
    (column === 'gameWinRate' && stats.gameWinRate === null)
  );
}

/**
 * Rows in sort order. Unknown is always last; `null` rates go last in both directions; ties
 * keep the report order (players descending, then name).
 */
function sortRows(rows: Row[], { column, direction }: Sort): Row[] {
  const sign = direction === 'ascending' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const aUnknown = a.stats.archetype === null;
    const bUnknown = b.stats.archetype === null;
    if (aUnknown || bUnknown) {
      return Number(aUnknown) - Number(bUnknown);
    }
    const aNull = isNull(column, a.stats);
    const bNull = isNull(column, b.stats);
    if (aNull || bNull) {
      return Number(aNull) - Number(bNull) || a.order - b.order;
    }
    return sign * compareColumn(column, a.stats, b.stats) || a.order - b.order;
  });
}

/** Every archetype of the report, sortable by every column. */
export function ArchetypeTable({ archetypes }: { archetypes: ArchetypeStats[] }) {
  const { t } = useTranslation();
  const format = useStatsFormat();
  const [sort, setSort] = useState<Sort>({ column: 'players', direction: 'descending' });
  const rows = sortRows(
    archetypes.map((stats, order) => ({ stats, order })),
    sort,
  );

  function toggle(column: Column) {
    setSort((current) =>
      current.column === column
        ? {
            column,
            direction: current.direction === 'ascending' ? 'descending' : 'ascending',
          }
        : { column, direction: column === 'archetype' ? 'ascending' : 'descending' },
    );
  }

  return (
    <Table.ScrollContainer minWidth={720}>
      <Table withTableBorder fz="sm" aria-label={t('metagame.tableLabel')}>
        <Table.Thead>
          <Table.Tr>
            {COLUMNS.map((column) => {
              const active = sort.column === column;
              return (
                <Table.Th key={column} aria-sort={active ? sort.direction : 'none'}>
                  <UnstyledButton fw={700} fz="sm" onClick={() => toggle(column)}>
                    {t(`metagame.columns.${column}`)}
                    {active && (
                      <span aria-hidden="true">
                        {' '}
                        {t(`players.sortIndicator.${sort.direction}`)}
                      </span>
                    )}
                  </UnstyledButton>
                </Table.Th>
              );
            })}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map(({ stats }) => (
            <Table.Tr key={stats.archetype ?? ''}>
              <Table.Td>{stats.archetype ?? t('metagame.unknown')}</Table.Td>
              <Table.Td>{stats.players}</Table.Td>
              <Table.Td>{format.percent(stats.share)}</Table.Td>
              <Table.Td>{format.record(stats.matches)}</Table.Td>
              <Table.Td>{format.percent(stats.matchWinRate)}</Table.Td>
              <Table.Td>{format.percent(stats.gameWinRate)}</Table.Td>
              <Table.Td>{stats.topCut}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
