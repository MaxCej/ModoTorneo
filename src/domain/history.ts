import { domainError, type DomainError } from './errors';
import { effectiveEvents, reduce, stateAt } from './reduce';
import { err, ok, type Result } from './result';
import type { Uuid } from './schemas/common';
import type { TournamentEvent } from './schemas/events';
import type { TournamentState } from './state';

export type HistoryEntry = {
  event: TournamentEvent;
  voided: boolean; // seq is in state.voidedSeqs
  canRollBackTo: boolean; // effective, and at least one effective event has a higher seq
};

export type MatchRef = { round: number; playerA: Uuid; playerB: Uuid | null };

export type History = {
  entries: HistoryEntry[]; // newest first (seq descending)
  playerNames: Record<Uuid, string>; // from every PlayerRegistered, voided ones included
  matches: Record<Uuid, MatchRef>; // from every RoundPaired and PlayersSwapped, voided ones included
};

/**
 * The log as rows for the History tab, newest first, with the names and matches its labels need.
 * Names and matches are collected in log order, so a result reported after a swap resolves to
 * the swapped players.
 */
export function historyOf(events: TournamentEvent[], tournamentId: Uuid): History {
  const state = reduce(events, tournamentId);
  const voided = new Set(state.voidedSeqs);
  const newestEffective = state.effectiveSeqs.at(-1);
  const playerNames: Record<Uuid, string> = {};
  const matches: Record<Uuid, MatchRef> = {};

  for (const event of events) {
    if (event.type === 'PlayerRegistered') {
      playerNames[event.payload.playerId] = event.payload.playerName;
    } else if (event.type === 'RoundPaired') {
      const { round, pairings } = event.payload;
      for (const { matchId, playerA, playerB } of pairings) {
        matches[matchId] = { round, playerA, playerB };
      }
    } else if (event.type === 'PlayersSwapped') {
      const { round, playerA, playerB } = event.payload;
      const other = (id: Uuid) => (id === playerA ? playerB : id === playerB ? playerA : id);
      for (const [matchId, ref] of Object.entries(matches)) {
        if (ref.round === round) {
          matches[matchId] = {
            round,
            playerA: other(ref.playerA),
            playerB: ref.playerB === null ? null : other(ref.playerB),
          };
        }
      }
    }
  }

  const entries = events
    .map((event) => {
      const isVoided = voided.has(event.seq);
      return {
        event,
        voided: isVoided,
        canRollBackTo: !isVoided && event.type !== 'RolledBack' && event.seq !== newestEffective,
      };
    })
    .reverse();
  return { entries, playerNames, matches };
}

export type RollbackPreview = {
  undone: TournamentEvent[]; // effective events with seq > toSeq, ascending
  after: TournamentState; // stateAt(events, toSeq, tournamentId)
};

/** Returns INVALID_ROLLBACK_TARGET when toSeq is not a valid target (same rule as validate). */
export function rollbackPreview(
  events: TournamentEvent[],
  toSeq: number,
  tournamentId: Uuid,
): Result<RollbackPreview, DomainError> {
  const state = reduce(events, tournamentId);
  if (toSeq >= state.lastSeq || !state.effectiveSeqs.includes(toSeq)) {
    return err(
      domainError(
        'INVALID_ROLLBACK_TARGET',
        `Seq ${toSeq} is not an effective event before seq ${state.lastSeq}`,
      ),
    );
  }
  const undone = effectiveEvents(events).filter((event) => event.seq > toSeq);
  return ok({ undone, after: stateAt(events, toSeq, tournamentId) });
}
