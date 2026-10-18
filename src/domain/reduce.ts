import { CorruptLogError, domainError } from './errors';
import type { Uuid } from './schemas/common';
import type { TournamentEvent } from './schemas/events';
import { IMPLICIT_BYE_RESULT } from './schemas/matchResult';
import { initialState, type Round, type TournamentState } from './state';
import { resolvedSwissRounds, validate } from './validate';

/**
 * Applies one event that `validate` already accepted. Never mutates `state`.
 * `state` is `null` only for the first event (`TournamentCreated`).
 * `RolledBack` needs earlier states, so only `reduce` handles it.
 */
export function apply(
  state: TournamentState | null,
  event: TournamentEvent,
  tournamentId: Uuid,
): TournamentState {
  if (state === null) {
    if (event.type !== 'TournamentCreated') {
      throw new Error('apply: the first event must be TournamentCreated');
    }
    return initialState(tournamentId, event);
  }

  const next = { ...state, lastSeq: event.seq, effectiveSeqs: [...state.effectiveSeqs, event.seq] };

  switch (event.type) {
    case 'TournamentCreated':
      throw new Error('apply: TournamentCreated must be the first event');

    case 'PlayerRegistered': {
      const { playerId, playerName, deckId, guest } = event.payload;
      const entry = {
        playerId,
        playerName,
        ...(deckId === undefined ? {} : { deckId }),
        guest: guest ?? false,
        dropped: false,
        registeredAtRound: state.rounds.length,
      };
      return { ...next, players: { ...state.players, [playerId]: entry } };
    }

    case 'PlayerDropped': {
      const { playerId } = event.payload;
      const entry = { ...state.players[playerId], dropped: true };
      return { ...next, players: { ...state.players, [playerId]: entry } };
    }

    case 'PlayerUnregistered': {
      // Removes the entry, so the same playerId can register again.
      const players = { ...state.players };
      delete players[event.payload.playerId];
      return { ...next, players };
    }

    case 'RoundPaired': {
      const { round, stage, pairings } = event.payload;
      const matches = pairings.map((pairing) => ({
        ...pairing,
        result: pairing.playerB === null ? IMPLICIT_BYE_RESULT : null,
      }));
      const status = stage === 'swiss' && state.status === 'setup' ? 'running' : state.status;
      // The first swiss round fixes an auto (null) round count from the active players.
      const swissRounds = stage === 'swiss' ? resolvedSwissRounds(state) : state.swissRounds;
      return {
        ...next,
        status,
        swissRounds,
        rounds: [...state.rounds, { number: round, stage, closed: false, matches }],
      };
    }

    case 'ResultReported': {
      const { matchId, result } = event.payload;
      return {
        ...next,
        rounds: updateCurrentRound(state, (round) => ({
          ...round,
          matches: round.matches.map((m) => (m.matchId === matchId ? { ...m, result } : m)),
        })),
      };
    }

    case 'RoundClosed':
      return {
        ...next,
        rounds: updateCurrentRound(state, (round) => ({ ...round, closed: true })),
      };

    case 'TopCutStarted':
      return { ...next, status: 'topCut', topCut: event.payload.size };

    case 'TournamentFinished':
      return { ...next, status: 'finished' };

    case 'RolledBack':
      throw new Error('apply: RolledBack is handled by reduce');
  }
}

/** Replaces the last (current) round. */
function updateCurrentRound(state: TournamentState, update: (round: Round) => Round): Round[] {
  return state.rounds.map((round, i) => (i === state.rounds.length - 1 ? update(round) : round));
}

/** State right after one effective event was applied. */
type Snapshot = { seq: number; state: TournamentState };

/**
 * Replays the log, validating every event. Returns the final state and one snapshot per
 * effective event, in seq order. Throws `CorruptLogError` when any event breaks an invariant.
 */
function replay(
  events: readonly TournamentEvent[],
  tournamentId: Uuid,
): { state: TournamentState; snapshots: Snapshot[] } {
  let state: TournamentState | null = null;
  let snapshots: Snapshot[] = [];
  for (const event of events) {
    const error = validate(state, event);
    if (error !== null) {
      throw new CorruptLogError(error);
    }
    if (state !== null && event.type === 'RolledBack') {
      const { toSeq } = event.payload;
      const kept = snapshots.filter((s) => s.seq <= toSeq);
      const voided = snapshots.filter((s) => s.seq > toSeq).map((s) => s.seq);
      const target = kept[kept.length - 1].state;
      state = {
        ...target,
        lastSeq: event.seq,
        voidedSeqs: [...state.voidedSeqs, ...voided].sort((a, b) => a - b),
      };
      snapshots = kept;
    } else {
      state = apply(state, event, tournamentId);
      snapshots.push({ seq: event.seq, state });
    }
  }
  if (state === null) {
    throw new CorruptLogError(domainError('FIRST_EVENT_NOT_CREATED', 'The event log is empty'));
  }
  return { state, snapshots };
}

/**
 * Derives the tournament state from its event log, folding only the effective events.
 * Throws `CorruptLogError` when any event breaks an invariant.
 */
export function reduce(events: readonly TournamentEvent[], tournamentId: Uuid): TournamentState {
  return replay(events, tournamentId).state;
}

/**
 * The events still in effect: on `RolledBack { toSeq }` every effective event with
 * `seq > toSeq` is dropped. `RolledBack` events themselves are never effective.
 */
export function effectiveEvents(events: readonly TournamentEvent[]): TournamentEvent[] {
  const effective: TournamentEvent[] = [];
  for (const event of events) {
    if (event.type === 'RolledBack') {
      while (effective.length > 0 && effective[effective.length - 1].seq > event.payload.toSeq) {
        effective.pop();
      }
    } else {
      effective.push(event);
    }
  }
  return effective;
}

/**
 * Previews a rollback target: the state as it was right after the last effective event
 * with `seq <= seq` was applied, including its `lastSeq`, `voidedSeqs` and `effectiveSeqs`.
 */
export function stateAt(
  events: readonly TournamentEvent[],
  seq: number,
  tournamentId: Uuid,
): TournamentState {
  const { snapshots } = replay(events, tournamentId);
  const snapshot = snapshots.findLast((s) => s.seq <= seq);
  if (snapshot === undefined) {
    throw new RangeError(`No effective event at or before seq ${seq}`);
  }
  return snapshot.state;
}
