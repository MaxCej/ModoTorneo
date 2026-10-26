import { Alert, List, SegmentedControl, Stack } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  pairingWarnings,
  playerRecords,
  type Command,
  type DomainError,
  type Result,
  type Round,
  type TournamentState,
} from '../../domain';
import { ByPlayerList } from './ByPlayerList';
import { MatchRow } from './MatchRow';
import { SwapPlayers } from './SwapPlayers';

type Props = {
  state: TournamentState;
  round: Round;
  onDispatch: (cmd: Command) => Result<TournamentState, DomainError>;
};

/** One round, by table or by player. A closed round is read-only. */
export function RoundPanel({ state, round, onDispatch }: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<'table' | 'player'>('table');
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

  const name = (playerId: string) => state.players[playerId]?.playerName ?? playerId;
  const tableOf = (matchId: string) => round.matches.find((m) => m.matchId === matchId)?.table;
  // Warnings and swaps only matter while the round can still change.
  const editable = !readOnly && round.stage === 'swiss';
  const warnings = editable ? pairingWarnings(state, round.number) : [];

  return (
    <Stack>
      {warnings.length > 0 && (
        <Alert color="yellow" title={t('tournament.rounds.warnings.title')}>
          <List size="sm">
            {warnings.map((warning) => (
              <List.Item key={`${warning.kind}-${warning.matchId}`}>
                {warning.kind === 'rematch'
                  ? t('tournament.rounds.warnings.rematch', {
                      table: tableOf(warning.matchId),
                      nameA: name(warning.playerA),
                      nameB: name(warning.playerB),
                    })
                  : t('tournament.rounds.warnings.repeatBye', { name: name(warning.playerId) })}
              </List.Item>
            ))}
          </List>
        </Alert>
      )}
      {editable && <SwapPlayers state={state} round={round} onDispatch={onDispatch} />}
      <SegmentedControl
        w="fit-content"
        aria-label={t('tournament.rounds.viewLabel')}
        value={view}
        onChange={(value) => setView(value as 'table' | 'player')}
        data={[
          { value: 'table', label: t('tournament.rounds.byTable') },
          { value: 'player', label: t('tournament.rounds.byPlayer') },
        ]}
      />
      {view === 'player' ? (
        <ByPlayerList state={state} round={round} />
      ) : (
        <Stack gap={0}>
          {[...round.matches]
            .sort((a, b) => a.table - b.table)
            .map((match) => (
              <MatchRow
                key={match.matchId}
                match={match}
                labelA={label(match.playerA)}
                labelB={match.playerB === null ? null : label(match.playerB)}
                deckA={state.players[match.playerA]?.deck ?? null}
                deckB={match.playerB === null ? null : (state.players[match.playerB]?.deck ?? null)}
                readOnly={readOnly}
                stage={round.stage}
                bestOf={state.topCutBestOf ?? 3}
                onReport={(result) =>
                  onDispatch({
                    type: 'ResultReported',
                    payload: { matchId: match.matchId, result },
                  })
                }
              />
            ))}
        </Stack>
      )}
    </Stack>
  );
}
