import { domainError, type DomainError } from './errors';
import type {
  PlayersSwapped,
  ResultReported,
  RoundClosed,
  RoundPaired,
  TopCutStarted,
  TournamentDetailsChanged,
  TournamentDetailsChangedPayload,
  TournamentEvent,
  TournamentFinished,
} from './schemas/events';
import { matchOutcome } from './schemas/matchResult';
import { activePlayerCount, type TournamentState } from './state';
import { recommendedSwissRounds } from './swissRounds';

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

    case 'PlayerUnregistered': {
      // Once a round exists the player has history; PlayerDropped is the only removal.
      if (state.status !== 'setup') {
        return wrongStatus(state, event);
      }
      if (!(event.payload.playerId in state.players)) {
        return domainError(
          'UNKNOWN_PLAYER',
          `Player ${event.payload.playerId} is not registered`,
          event.seq,
        );
      }
      return null;
    }

    case 'TournamentDetailsChanged':
      return validateDetailsChanged(state, event);

    case 'RoundPaired':
      return event.payload.stage === 'swiss'
        ? validateSwissPairing(state, event)
        : validateTopCutPairing(state, event);

    case 'PlayersSwapped':
      return validateSwap(state, event);

    case 'ResultReported':
      return validateResult(state, event);

    case 'RoundClosed':
      return validateRoundClosed(state, event);

    case 'TopCutStarted':
      return validateTopCutStarted(state, event);

    case 'TournamentFinished':
      return validateFinished(state, event);

    case 'RolledBack': {
      // Allowed in any status. Voided and RolledBack seqs are never effective (no redo).
      const { toSeq } = event.payload;
      if (toSeq >= state.lastSeq || !state.effectiveSeqs.includes(toSeq)) {
        return domainError(
          'INVALID_ROLLBACK_TARGET',
          `Seq ${toSeq} is not an effective event before seq ${state.lastSeq}`,
          event.seq,
        );
      }
      return null;
    }
  }
}

export type DetailField = keyof TournamentDetailsChangedPayload;

/** Format is fixed once play starts; swiss rounds are fixed once swiss ends. */
const EDITABLE_DETAILS: Record<TournamentState['status'], readonly DetailField[]> = {
  setup: ['name', 'date', 'location', 'format', 'swissRounds'],
  running: ['name', 'date', 'location', 'swissRounds'],
  topCut: ['name', 'date', 'location'],
  finished: ['name', 'date', 'location'],
};

/** The `TournamentDetailsChanged` fields allowed in `status`. Shared with the UI. */
export function editableDetails(status: TournamentState['status']): readonly DetailField[] {
  return EDITABLE_DETAILS[status];
}

function validateDetailsChanged(
  state: TournamentState,
  event: TournamentDetailsChanged,
): DomainError | null {
  const allowed = EDITABLE_DETAILS[state.status];
  const fields = (Object.keys(event.payload) as DetailField[]).filter(
    (field) => event.payload[field] !== undefined,
  );
  const blocked = fields.find((field) => !allowed.includes(field));
  if (blocked !== undefined) {
    return domainError(
      'WRONG_STATUS',
      `${blocked} cannot change while the tournament is ${state.status}`,
      event.seq,
    );
  }

  const { swissRounds } = event.payload;
  if (swissRounds === undefined || state.status === 'setup') {
    return null;
  }
  if (swissRounds === null) {
    return domainError(
      'INVALID_DETAILS',
      'Swiss rounds cannot go back to auto once round 1 is paired',
      event.seq,
    );
  }
  const paired = state.rounds.filter((round) => round.stage === 'swiss').length;
  if (swissRounds < paired) {
    return domainError(
      'INVALID_DETAILS',
      `Swiss rounds cannot be ${swissRounds}: ${paired} swiss rounds are already paired`,
      event.seq,
    );
  }
  return null;
}

function validateTopCutPairing(state: TournamentState, event: RoundPaired): DomainError | null {
  if (state.status !== 'topCut') {
    return wrongStatus(state, event);
  }
  const roundError = validateNextRound(state, event);
  if (roundError !== null) {
    return roundError;
  }
  if (event.payload.pairings.some((p) => p.playerB === null)) {
    return invalidPairings('Top cut rounds have no byes', event);
  }
  return validatePairingStructure(state, event);
}

function validateTopCutStarted(state: TournamentState, event: TopCutStarted): DomainError | null {
  if (state.status !== 'running') {
    return wrongStatus(state, event);
  }
  const openError = noOpenRound(state, event);
  if (openError !== null) {
    return openError;
  }
  // Swiss may stop before `swissRounds`, but standings need at least one round.
  if (state.rounds.length === 0) {
    return domainError(
      'ROUND_OUT_OF_ORDER',
      'At least one swiss round must be played before the top cut',
      event.seq,
    );
  }
  const active = activePlayerCount(state);
  if (event.payload.size > active) {
    return domainError(
      'WRONG_STATUS',
      `Top ${event.payload.size} needs at least ${event.payload.size} active players, got ${active}`,
      event.seq,
    );
  }
  return null;
}

/** Allowed before all swiss rounds are played and without a top cut. `finished` is terminal. */
function validateFinished(state: TournamentState, event: TournamentFinished): DomainError | null {
  if (state.status !== 'running' && state.status !== 'topCut') {
    return wrongStatus(state, event);
  }
  return noOpenRound(state, event);
}

function noOpenRound(state: TournamentState, event: TournamentEvent): DomainError | null {
  const current = state.rounds.at(-1);
  if (current !== undefined && !current.closed) {
    return domainError('ROUND_STILL_OPEN', `Round ${current.number} is still open`, event.seq);
  }
  return null;
}

function validateSwissPairing(state: TournamentState, event: RoundPaired): DomainError | null {
  if (state.status !== 'setup' && state.status !== 'running') {
    return wrongStatus(state, event);
  }
  const roundError = validateNextRound(state, event);
  if (roundError !== null) {
    return roundError;
  }
  const swissRounds = resolvedSwissRounds(state);
  // null only with fewer than 2 active players, which the active-player check below rejects.
  if (swissRounds !== null && event.payload.round > swissRounds) {
    return domainError(
      'TOO_MANY_ROUNDS',
      `The tournament has only ${swissRounds} swiss rounds`,
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

/**
 * The stored `swissRounds`, or for `null` (auto) the recommendation for the active players.
 * Shared with the reducer, which stores this value on the first swiss `RoundPaired`.
 */
export function resolvedSwissRounds(state: TournamentState): number | null {
  return state.swissRounds ?? recommendedSwissRounds(activePlayerCount(state));
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
  if (round.stage === 'topCut') {
    const outcome = matchOutcome(event.payload.result);
    if (outcome !== 'A' && outcome !== 'B') {
      return domainError(
        'TOP_CUT_DRAW',
        `A top cut match needs a winner, got ${outcome}`,
        event.seq,
      );
    }
  }
  return null;
}

/** Two active players in unreported matches of the open swiss round trade seats. */
function validateSwap(state: TournamentState, event: PlayersSwapped): DomainError | null {
  const { round, playerA, playerB } = event.payload;
  const current = state.rounds.at(-1);
  if (current === undefined || current.closed) {
    return domainError('ROUND_CLOSED', 'There is no open round to swap players in', event.seq);
  }
  if (round !== current.number) {
    return domainError(
      'ROUND_OUT_OF_ORDER',
      `Round ${current.number} is the open round, got ${round}`,
      event.seq,
    );
  }
  if (current.stage !== 'swiss') {
    return domainError('WRONG_STATUS', 'Players can be swapped only in swiss rounds', event.seq);
  }

  const matchOf = (playerId: string) =>
    current.matches.find((m) => m.playerA === playerId || m.playerB === playerId);
  const matchA = matchOf(playerA);
  const matchB = matchOf(playerB);
  for (const [playerId, match] of [
    [playerA, matchA],
    [playerB, matchB],
  ] as const) {
    if (match === undefined) {
      return domainError(
        'UNKNOWN_PLAYER',
        `Player ${playerId} is not paired in round ${round}`,
        event.seq,
      );
    }
    if (state.players[playerId]?.dropped) {
      return domainError('PLAYER_DROPPED', `Player ${playerId} has dropped`, event.seq);
    }
  }
  if (playerA === playerB || matchA === matchB) {
    return domainError('INVALID_SWAP', 'Swap two players from different matches', event.seq);
  }
  // A bye's result is implicit, so a bye counts as unreported.
  const reported = [matchA!, matchB!].find((m) => m.playerB !== null && m.result !== null);
  if (reported !== undefined) {
    return domainError('INVALID_SWAP', `Match ${reported.matchId} already has a result`, event.seq);
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
