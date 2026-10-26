import { useTranslation } from 'react-i18next';
import type { IsoDate, MatchCounts } from '../../domain';

/** Formatters shared by the players page and the profile. */
export function useStatsFormat() {
  const { t } = useTranslation();
  const none = t('players.none');
  const ordinal = (n: number) => t('tournament.topCut.ordinal', { count: n, ordinal: true });
  return {
    none,
    percent: (rate: number | null) =>
      rate === null ? none : t('tournament.standings.percent', { value: (rate * 100).toFixed(2) }),
    record: ({ wins, losses, draws }: MatchCounts) =>
      t('tournament.standings.recordValue', { wins, losses, draws }),
    date: (date: IsoDate | null) => date ?? none,
    placing: (placing: { from: number; to: number } | null) =>
      placing === null
        ? none
        : placing.from === placing.to
          ? ordinal(placing.from)
          : t('tournament.topCut.placeRange', {
              from: ordinal(placing.from),
              to: ordinal(placing.to),
            }),
  };
}
