import { CorruptLogError, domainError } from './errors';
import type { Uuid } from './schemas/common';
import type { TournamentEvent } from './schemas/events';
import { IMPLICIT_BYE_RESULT } from './schemas/matchResult';
import { initialState, type Round, type TournamentState } from './state';
import { validate } from './validate';

/**
 * Applies one event that `validate` already accepted. Never mutates `state`.
 * `state` is `null` only for the first event (`TournamentCreated`).
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

  const next = { ...state, lastSeq: event.seq };

  switch (event.type) {
    case 'TournamentCreated':
      throw new Error('apply: TournamentCreated must be the first event');

    case 'PlayerRegistered': {
      const { playerId, playerName, deckId } = event.payload;
      const entry = {
        playerId,
        playerName,
        ...(deckId === undefined ? {} : { deckId }),
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

    case 'RoundPaired': {
      const { round, stage, pairings } = event.payload;
      const matches = pairings.map((pairing) => ({
        ...pairing,
        result: pairing.playerB === null ? IMPLICIT_BYE_RESULT : null,
      }));
      const status = stage === 'swiss' && state.status === 'setup' ? 'running' : state.status;
      return {
        ...next,
        status,
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
    case 'TournamentFinished':
    case 'RolledBack':
      // Implemented in steps 6–7 of SPEC 02.
      throw new Error(`apply: ${event.type} is not supported yet`);
  }
}

/** Replaces the last (current) round. */
function updateCurrentRound(state: TournamentState, update: (round: Round) => Round): Round[] {
  return state.rounds.map((round, i) => (i === state.rounds.length - 1 ? update(round) : round));
}

/**
 * Derives the tournament state from its event log.
 * Throws `CorruptLogError` when any event breaks an invariant.
 */
export function reduce(events: readonly TournamentEvent[], tournamentId: Uuid): TournamentState {
  let state: TournamentState | null = null;
  for (const event of events) {
    const error = validate(state, event);
    if (error !== null) {
      throw new CorruptLogError(error);
    }
    state = apply(state, event, tournamentId);
  }
  if (state === null) {
    throw new CorruptLogError(domainError('FIRST_EVENT_NOT_CREATED', 'The event log is empty'));
  }
  return state;
}
