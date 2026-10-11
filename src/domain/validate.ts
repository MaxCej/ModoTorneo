import { domainError, type DomainError } from './errors';
import type { ResultReported, RoundClosed, RoundPaired, TournamentEvent } from './schemas/events';
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
      if (event.payload.stage === 'topCut') {
        // Implemented in step 6 of SPEC 02.
        throw new Error('validate: topCut RoundPaired is not supported yet');
      }
      return validateSwissPairing(state, event);

    case 'ResultReported':
      return validateResult(state, event);

    case 'RoundClosed':
      return validateRoundClosed(state, event);

    case 'TopCutStarted':
    case 'TournamentFinished':
    case 'RolledBack':
      // Implemented in steps 6–7 of SPEC 02.
      throw new Error(`validate: ${event.type} is not supported yet`);
  }
}

function validateSwissPairing(state: TournamentState, event: RoundPaired): DomainError | null {
  if (state.status !== 'setup' && state.status !== 'running') {
    return wrongStatus(state, event);
  }
  const roundError = validateNextRound(state, event);
  if (roundError !== null) {
    return roundError;
  }
  if (event.payload.round > state.swissRounds) {
    return domainError(
      'TOO_MANY_ROUNDS',
      `The tournament has only ${state.swissRounds} swiss rounds`,
      event.seq,
    );
  }

  const pairingError = validatePairingStructure(state, event);
  if (pairingError !== null) {
    return pairingError;
  }

  const active = Object.values(state.players).filter((player) => !player.dropped);
  if (active.length < 2) {
    return invalidPairings('A swiss round needs at least 2 active players', event);
  }
  const paired = new Set(
    event.payload.pairings.flatMap((p) =>
      p.playerB === null ? [p.playerA] : [p.playerA, p.playerB],
    ),
  );
  const missing = active.find((player) => !paired.has(player.playerId));
  if (missing !== undefined) {
    return invalidPairings(`Active player ${missing.playerId} is not paired`, event);
  }
  const byes = event.payload.pairings.filter((p) => p.playerB === null).length;
  if (byes > (active.length % 2 === 1 ? 1 : 0)) {
    return invalidPairings(
      `${byes} byes for ${active.length} active players; only an odd count gets one bye`,
      event,
    );
  }
  return null;
}

/** The previous round (if any) is closed and `round` is the next number. */
function validateNextRound(state: TournamentState, event: RoundPaired): DomainError | null {
  const previous = state.rounds.at(-1);
  if (previous !== undefined && !previous.closed) {
    return domainError(
      'ROUND_STILL_OPEN',
      `Round ${previous.number} must be closed before pairing a new round`,
      event.seq,
    );
  }
  const expected = state.rounds.length + 1;
  if (event.payload.round !== expected) {
    return domainError(
      'ROUND_OUT_OF_ORDER',
      `Expected round ${expected}, got ${event.payload.round}`,
      event.seq,
    );
  }
  return null;
}

/**
 * Rules shared by every stage: each player at most once, every player registered and active,
 * tables unique within the round, match ids unique across the tournament.
 */
function validatePairingStructure(state: TournamentState, event: RoundPaired): DomainError | null {
  const usedMatchIds = new Set(state.rounds.flatMap((r) => r.matches.map((m) => m.matchId)));
  const tables = new Set<number>();
  const players = new Set<string>();

  for (const pairing of event.payload.pairings) {
    if (tables.has(pairing.table)) {
      return invalidPairings(`Table ${pairing.table} is used twice`, event);
    }
    tables.add(pairing.table);

    if (usedMatchIds.has(pairing.matchId)) {
      return invalidPairings(`Match id ${pairing.matchId} is already used`, event);
    }
    usedMatchIds.add(pairing.matchId);

    for (const playerId of [pairing.playerA, pairing.playerB]) {
      if (playerId === null) {
        continue;
      }
      const player = state.players[playerId];
      if (player === undefined) {
        return domainError('UNKNOWN_PLAYER', `Player ${playerId} is not registered`, event.seq);
      }
      if (player.dropped) {
        return domainError('PLAYER_DROPPED', `Player ${playerId} has dropped`, event.seq);
      }
      if (players.has(playerId)) {
        return invalidPairings(`Player ${playerId} is paired more than once`, event);
      }
      players.add(playerId);
    }
  }
  return null;
}

function validateResult(state: TournamentState, event: ResultReported): DomainError | null {
  const { matchId } = event.payload;
  const round = state.rounds.find((r) => r.matches.some((m) => m.matchId === matchId));
  if (round === undefined) {
    return domainError('UNKNOWN_MATCH', `Match ${matchId} does not exist`, event.seq);
  }
  if (round.closed) {
    return domainError('ROUND_CLOSED', `Round ${round.number} is already closed`, event.seq);
  }
  const match = round.matches.find((m) => m.matchId === matchId);
  if (match?.playerB === null) {
    return domainError(
      'BYE_RESULT',
      `Match ${matchId} is a bye; its result is implicit`,
      event.seq,
    );
  }
  return null;
}

function validateRoundClosed(state: TournamentState, event: RoundClosed): DomainError | null {
  const current = state.rounds.at(-1);
  if (current === undefined || current.closed) {
    return domainError('ROUND_CLOSED', 'There is no open round to close', event.seq);
  }
  if (event.payload.round !== current.number) {
    return domainError(
      'ROUND_OUT_OF_ORDER',
      `Round ${current.number} is the open round, got ${event.payload.round}`,
      event.seq,
    );
  }
  const missing = current.matches.filter((m) => m.result === null).length;
  if (missing > 0) {
    return domainError(
      'MISSING_RESULTS',
      `Round ${current.number} has ${missing} matches without a result`,
      event.seq,
    );
  }
  return null;
}

function invalidPairings(message: string, event: RoundPaired): DomainError {
  return domainError('INVALID_PAIRINGS', message, event.seq);
}

function wrongStatus(state: TournamentState, event: TournamentEvent): DomainError {
  return domainError(
    'WRONG_STATUS',
    `${event.type} is not allowed while the tournament is ${state.status}`,
    event.seq,
  );
}
