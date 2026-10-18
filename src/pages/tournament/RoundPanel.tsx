import { Stack } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import {
  playerRecords,
  type Command,
  type DomainError,
  type Result,
  type Round,
  type TournamentState,
} from '../../domain';
import { MatchRow } from './MatchRow';

type Props = {
  state: TournamentState;
  round: Round;
  onDispatch: (cmd: Command) => Result<TournamentState, DomainError>;
};

/** One round: its matches by table. A closed round is read-only. */
export function RoundPanel({ state, round, onDispatch }: Props) {
  const { t } = useTranslation();
  // Points and record from earlier rounds only.
  const records = playerRecords(state, round.number);
  const readOnly = round.closed;

  const label = (playerId: string) => {
    const record = records[playerId];
    const name = state.players[playerId]?.playerName ?? playerId;
    return record === undefined
      ? name
      : t('tournament.rounds.playerLabel', {
          name,
          points: record.matchPoints,
          wins: record.wins,
          losses: record.losses,
          draws: record.draws,
        });
  };

  return (
    <Stack gap={0}>
      {[...round.matches]
        .sort((a, b) => a.table - b.table)
        .map((match) => (
          <MatchRow
            key={match.matchId}
            match={match}
            labelA={label(match.playerA)}
            labelB={match.playerB === null ? null : label(match.playerB)}
            readOnly={readOnly}
            onReport={(result) =>
              onDispatch({ type: 'ResultReported', payload: { matchId: match.matchId, result } })
            }
          />
        ))}
    </Stack>
  );
}
