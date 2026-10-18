import { Table } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { MatchResult, Round, TournamentState } from '../../domain';
import { useResultText } from './MatchRow';

type Props = {
  state: TournamentState;
  round: Round;
};

/** Same order as the player lists: English collation, then id. */
const collator = new Intl.Collator('en');

/** The result seen from player B's side. */
function flipped(result: MatchResult): MatchResult {
  return { ...result, winsA: result.winsB, winsB: result.winsA };
}

/** Every player of the round, name asc: table, opponent and result from their side. Read-only. */
export function ByPlayerList({ state, round }: Props) {
  const { t } = useTranslation();
  const resultText = useResultText();
  const name = (playerId: string) => state.players[playerId]?.playerName ?? playerId;

  const rows = round.matches.flatMap((match) => {
    const a = {
      playerId: match.playerA,
      table: match.table,
      opponent: match.playerB === null ? t('tournament.rounds.bye') : name(match.playerB),
      result: match.result,
    };
    if (match.playerB === null) {
      return [a];
    }
    const b = {
      playerId: match.playerB,
      table: match.table,
      opponent: name(match.playerA),
      result: match.result === null ? null : flipped(match.result),
    };
    return [a, b];
  });
  rows.sort(
    (x, y) =>
      collator.compare(name(x.playerId), name(y.playerId)) ||
      (x.playerId < y.playerId ? -1 : x.playerId > y.playerId ? 1 : 0),
  );

  return (
    <Table striped aria-label={t('tournament.rounds.byPlayerLabel', { round: round.number })}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{t('tournament.rounds.columns.player')}</Table.Th>
          <Table.Th>{t('tournament.rounds.columns.table')}</Table.Th>
          <Table.Th>{t('tournament.rounds.columns.opponent')}</Table.Th>
          <Table.Th>{t('tournament.rounds.columns.result')}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={row.playerId}>
            <Table.Td>{name(row.playerId)}</Table.Td>
            <Table.Td>{row.table}</Table.Td>
            <Table.Td>{row.opponent}</Table.Td>
            <Table.Td>{resultText(row.result)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
