import {
  playerResults,
  type IsoDateTime,
  type Player,
  type TournamentDocument,
  type TournamentState,
} from '../domain';
import type { Revision, TournamentSummary } from './types';

/** Summary row fields, derived from the replayed state. Never edited directly. */
export function toSummary(
  doc: TournamentDocument,
  state: TournamentState,
  revision: Revision,
  updatedAt: IsoDateTime,
): TournamentSummary {
  return {
    id: doc.id,
    name: state.name,
    date: state.date,
    format: state.format,
    status: state.status,
    eventCount: doc.events.length,
    playerCount: Object.keys(state.players).length,
    updatedAt,
    revision,
    players: playerResults(state),
  };
}

/** Name order. Fixed to English (the only UI locale) so it does not depend on the runtime. */
const collator = new Intl.Collator('en');

/** Final tie-breaker on ids, so equal names still come back in a deterministic order. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Tournament list order: date descending, then name ascending, then id. */
export function compareSummaries(
  a: Pick<TournamentSummary, 'date' | 'name' | 'id'>,
  b: Pick<TournamentSummary, 'date' | 'name' | 'id'>,
): number {
  return (
    (a.date === b.date ? 0 : a.date < b.date ? 1 : -1) ||
    collator.compare(a.name, b.name) ||
    byCodeUnit(a.id, b.id)
  );
}

/** Player list order: name ascending, then id. */
export function comparePlayers(a: Player, b: Player): number {
  return collator.compare(a.name, b.name) || byCodeUnit(a.id, b.id);
}
