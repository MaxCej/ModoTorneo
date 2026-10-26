import type { TFunction } from 'i18next';
import { topCutRoundName } from '../../domain';
import type { OpenRound } from '../../storage/timerStorage';

/** "Round 3", or the top cut round name, as on the round tabs. */
export function roundLabel(t: TFunction, round: OpenRound): string {
  return round.stage === 'topCut'
    ? t(`tournament.topCut.rounds.${topCutRoundName(round.matches)}`)
    : t('tournament.rounds.tabRound', { round: round.round });
}
