import {
  Anchor,
  Container,
  Loader,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { playerProfile, playerTotals, type Player, type PlayerTotals } from '../domain';
import { readSettings } from '../storage';
import { StorageErrorAlert } from './StorageErrorAlert';
import { useStatsFormat } from './players/format';
import { usePlayersData } from './players/usePlayersData';

const COLUMNS = [
  'name',
  'tournaments',
  'record',
  'matchWinRate',
  'gameWinRate',
  'lastPlayed',
] as const;
type Column = (typeof COLUMNS)[number];
type Sort = { column: Column; direction: 'ascending' | 'descending' };

type Row = { player: Player; totals: PlayerTotals; order: number };

const EMPTY_TOTALS = playerProfile('', []).totals;

/** Negative when `a` comes first in ascending order. `null` values are handled by the caller. */
function compareColumn(column: Exclude<Column, 'name'>, a: PlayerTotals, b: PlayerTotals): number {
  switch (column) {
    case 'tournaments':
      return a.tournaments - b.tournaments;
    case 'record':
      // More wins, then fewer losses, is the better record.
      return a.matches.wins - b.matches.wins || b.matches.losses - a.matches.losses;
    case 'matchWinRate':
      return a.matchWinRate! - b.matchWinRate!;
    case 'gameWinRate':
      return a.gameWinRate! - b.gameWinRate!;
    case 'lastPlayed':
      return a.lastPlayed! < b.lastPlayed! ? -1 : a.lastPlayed! > b.lastPlayed! ? 1 : 0;
  }
}

function isNull(column: Column, totals: PlayerTotals): boolean {
  return (
    (column === 'matchWinRate' && totals.matchWinRate === null) ||
    (column === 'gameWinRate' && totals.gameWinRate === null) ||
    (column === 'lastPlayed' && totals.lastPlayed === null)
  );
}

/** Rows in sort order. `null` values go last in both directions; ties keep name order. */
function sortRows(rows: Row[], { column, direction }: Sort): Row[] {
  const sign = direction === 'ascending' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (column === 'name') {
      return sign * (a.order - b.order);
    }
    const aNull = isNull(column, a.totals);
    const bNull = isNull(column, b.totals);
    if (aNull || bNull) {
      return Number(aNull) - Number(bNull) || a.order - b.order;
    }
    return sign * compareColumn(column, a.totals, b.totals) || a.order - b.order;
  });
}

/** Every registry player with cross-tournament totals, from summary rows only. */
export function PlayersPage() {
  const { t } = useTranslation();
  const format = useStatsFormat();
  const data = usePlayersData();
  const [settings] = useState(readSettings);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>({ column: 'name', direction: 'ascending' });

  const rows = useMemo(() => {
    if (data.status !== 'ready') {
      return [];
    }
    const totals = playerTotals(data.tournaments);
    // The store keeps the registry in name order; `order` is that position.
    return data.players.map((player, order) => ({
      player,
      totals: totals[player.id] ?? EMPTY_TOTALS,
      order,
    }));
  }, [data]);

  const query = search.trim().toLowerCase();
  const visible = sortRows(
    rows.filter((row) => row.player.name.toLowerCase().includes(query)),
    sort,
  );

  function toggle(column: Column) {
    setSort((current) =>
      current.column === column
        ? {
            column,
            direction: current.direction === 'ascending' ? 'descending' : 'ascending',
          }
        : { column, direction: column === 'name' ? 'ascending' : 'descending' },
    );
  }

  return (
    <Container py="xl">
      <Stack>
        <Title order={1}>{t('players.title')}</Title>

        {data.status === 'error' && (
          <StorageErrorAlert error={data.error} settings={settings} page="players" />
        )}
        {data.status === 'loading' && <Loader />}
        {data.status === 'ready' && rows.length === 0 && <Text>{t('players.empty')}</Text>}
        {data.status === 'ready' && rows.length > 0 && (
          <>
            <TextInput
              label={t('players.search')}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
            {visible.length === 0 ? (
              <Text>{t('players.noMatch')}</Text>
            ) : (
              <Table.ScrollContainer minWidth={560}>
                <Table withTableBorder fz="sm" aria-label={t('players.tableLabel')}>
                  <Table.Thead>
                    <Table.Tr>
                      {COLUMNS.map((column) => {
                        const active = sort.column === column;
                        return (
                          <Table.Th key={column} aria-sort={active ? sort.direction : 'none'}>
                            <UnstyledButton fw={700} fz="sm" onClick={() => toggle(column)}>
                              {t(`players.columns.${column}`)}
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
                    {visible.map(({ player, totals }) => (
                      <Table.Tr key={player.id}>
                        <Table.Td>
                          <Anchor component={Link} to={`/players/${player.id}`}>
                            {player.name}
                          </Anchor>
                        </Table.Td>
                        <Table.Td>{totals.tournaments}</Table.Td>
                        <Table.Td>{format.record(totals.matches)}</Table.Td>
                        <Table.Td>{format.percent(totals.matchWinRate)}</Table.Td>
                        <Table.Td>{format.percent(totals.gameWinRate)}</Table.Td>
                        <Table.Td>{format.date(totals.lastPlayed)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </>
        )}
      </Stack>
    </Container>
  );
}
