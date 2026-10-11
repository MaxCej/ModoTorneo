import { CorruptLogError, domainError } from './errors';
import type { Uuid } from './schemas/common';
import type { TournamentEvent } from './schemas/events';
import { initialState, type TournamentState } from './state';
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

    case 'RoundPaired':
    case 'ResultReported':
    case 'RoundClosed':
    case 'TopCutStarted':
    case 'TournamentFinished':
    case 'RolledBack':
      // Implemented in steps 5–7 of SPEC 02.
      throw new Error(`apply: ${event.type} is not supported yet`);
  }
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
