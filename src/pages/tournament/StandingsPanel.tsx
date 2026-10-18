import { Text } from '@mantine/core';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { lastClosedSwissRound, standings, type TournamentState } from '../../domain';
import { StandingsTable } from './StandingsTable';

/** Swiss standings after the last closed swiss round, or an empty state before round 1 closes. */
export function StandingsPanel({ state }: { state: TournamentState }) {
  const { t } = useTranslation();
  const round = lastClosedSwissRound(state);
  const rows = useMemo(() => standings(state, round), [state, round]);

  if (round === 0) {
    return <Text c="dimmed">{t('tournament.standings.empty')}</Text>;
  }
  return <StandingsTable rows={rows} round={round} />;
}
