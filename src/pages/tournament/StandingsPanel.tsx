import { Select, Stack, Text } from '@mantine/core';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { lastClosedSwissRound, standings, type TournamentState } from '../../domain';
import { StandingsTable } from './StandingsTable';

/**
 * Swiss standings after a closed swiss round picked in "After round" (the last one by default),
 * or an empty state before round 1 closes.
 */
export function StandingsPanel({ state }: { state: TournamentState }) {
  const { t } = useTranslation();
  const last = lastClosedSwissRound(state);
  // The organizer's pick. It falls back to the last closed round if a rollback reopened it.
  const [picked, setPicked] = useState<number | null>(null);
  const round = picked !== null && picked <= last ? picked : last;
  const rows = useMemo(() => standings(state, round), [state, round]);

  if (last === 0) {
    return <Text c="dimmed">{t('tournament.standings.empty')}</Text>;
  }
  return (
    <Stack>
      <Select
        label={t('tournament.standings.afterRound')}
        allowDeselect={false}
        maw={200}
        data={Array.from({ length: last }, (_, i) => ({
          value: String(i + 1),
          label: t('tournament.standings.roundOption', { round: i + 1 }),
        }))}
        value={String(round)}
        onChange={(value) => {
          if (value !== null) {
            setPicked(Number(value));
          }
        }}
      />
      <StandingsTable rows={rows} round={round} />
    </Stack>
  );
}
