import type { IsoDateTime, TournamentDocument, TournamentState } from '../domain';
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
    updatedAt,
    revision,
  };
}
