import { domainError, type DomainError } from './errors';
import type { TournamentEvent } from './schemas/events';
import type { TournamentState } from './state';

/**
 * Checks one event against the state built from every event before it.
 * `state` is `null` for the first event of the log.
 * Shared by the command layer (before appending) and the reducer (on replay).
 */
export function validate(
  state: TournamentState | null,
  event: TournamentEvent,
): DomainError | null {
  if (state === null) {
    if (event.type !== 'TournamentCreated') {
      return domainError(
        'FIRST_EVENT_NOT_CREATED',
        'The first event must be TournamentCreated',
        event.seq,
      );
    }
    if (event.seq !== 1) {
      return domainError('SEQ_GAP', `Expected seq 1, got ${event.seq}`, event.seq);
    }
    return null;
  }

  if (event.seq !== state.lastSeq + 1) {
    return domainError('SEQ_GAP', `Expected seq ${state.lastSeq + 1}, got ${event.seq}`, event.seq);
  }

  switch (event.type) {
    case 'TournamentCreated':
      return domainError(
        'DUPLICATE_CREATED',
        'TournamentCreated must be the only first event',
        event.seq,
      );

    case 'PlayerRegistered': {
      if (state.status !== 'setup' && state.status !== 'running') {
        return wrongStatus(state, event);
      }
      if (event.payload.playerId in state.players) {
        return domainError(
          'DUPLICATE_PLAYER',
          `Player ${event.payload.playerId} is already registered`,
          event.seq,
        );
      }
      return null;
    }

    case 'PlayerDropped': {
      if (state.status !== 'setup' && state.status !== 'running') {
        return wrongStatus(state, event);
      }
      const player = state.players[event.payload.playerId];
      if (player === undefined) {
        return domainError(
          'UNKNOWN_PLAYER',
          `Player ${event.payload.playerId} is not registered`,
          event.seq,
        );
      }
      if (player.dropped) {
        return domainError(
          'PLAYER_DROPPED',
          `Player ${event.payload.playerId} has already dropped`,
          event.seq,
        );
      }
      return null;
    }

    case 'RoundPaired':
    case 'ResultReported':
    case 'RoundClosed':
    case 'TopCutStarted':
    case 'TournamentFinished':
    case 'RolledBack':
      // Implemented in steps 5–7 of SPEC 02.
      throw new Error(`validate: ${event.type} is not supported yet`);
  }
}

function wrongStatus(state: TournamentState, event: TournamentEvent): DomainError {
  return domainError(
    'WRONG_STATUS',
    `${event.type} is not allowed while the tournament is ${state.status}`,
    event.seq,
  );
}
