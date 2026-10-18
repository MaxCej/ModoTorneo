import { Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { Round, TournamentState } from '../../domain';

type Props = {
  state: TournamentState;
  round: Round;
};

/** One round: its matches by table. */
export function RoundPanel({ state, round }: Props) {
  const { t } = useTranslation();
  const name = (playerId: string) => state.players[playerId]?.playerName ?? playerId;

  return (
    <Stack gap="xs">
      {[...round.matches]
        .sort((a, b) => a.table - b.table)
        .map((match) => (
          <Text key={match.matchId}>
            {match.playerB === null
              ? t('tournament.rounds.byeLine', { table: match.table, name: name(match.playerA) })
              : t('tournament.rounds.matchLine', {
                  table: match.table,
                  nameA: name(match.playerA),
                  nameB: name(match.playerB),
                })}
          </Text>
        ))}
    </Stack>
  );
}
