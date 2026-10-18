import { domainError, type DomainError } from './errors';
import { newId } from './ids';
import { playerRecords, type PlayerRecord } from './points';
import { err, ok, type Result } from './result';
import type { Uuid } from './schemas/common';
import type { Pairing, RoundPairedPayload } from './schemas/events';
import { activePlayerCount, type TournamentState } from './state';
import { resolvedSwissRounds } from './validate';

/** Backtracking steps (opponents tried) per rematch allowance. */
export const SEARCH_BUDGET = 100_000;

/** `random` returns a number in [0, 1), like `Math.random`. */
export type PairingDeps = { random: () => number; newId: () => Uuid };

export type PairingWarning =
  | { kind: 'rematch'; matchId: Uuid; playerA: Uuid; playerB: Uuid }
  | { kind: 'repeatBye'; matchId: Uuid; playerId: Uuid };

const defaultDeps: PairingDeps = { random: Math.random, newId };

/**
 * Pairings for the next swiss round. The payload always passes `validate`.
 * `deps.random` is used first to break bye ties, then to shuffle the field.
 */
export function pairSwissRound(
  state: TournamentState,
  deps: PairingDeps = defaultDeps,
): Result<RoundPairedPayload, DomainError> {
  const precondition = checkPreconditions(state);
  if (precondition !== null) {
    return err(precondition);
  }
  const records = playerRecords(state);
  const active = Object.values(state.players)
    .filter((player) => !player.dropped)
    .map((player) => records[player.playerId]);

  const bye = active.length % 2 === 1 ? pickBye(active, deps.random) : null;
  const field = orderField(
    active.filter((record) => record !== bye),
    deps.random,
  );
  const pairs = pairWithFewestRematches(field);

  const pairings: Pairing[] = pairs.map(([a, b], i) => ({
    matchId: deps.newId(),
    table: i + 1,
    playerA: a.playerId,
    playerB: b.playerId,
  }));
  if (bye !== null) {
    pairings.push({
      matchId: deps.newId(),
      table: pairs.length + 1,
      playerA: bye.playerId,
      playerB: null,
    });
  }
  return ok({ round: state.rounds.length + 1, stage: 'swiss', pairings });
}

/**
 * Rematches and repeated byes in swiss round `round`, against the rounds before it, in table
 * order. Empty for an unknown or top cut round.
 */
export function pairingWarnings(state: TournamentState, round: number): PairingWarning[] {
  const target = state.rounds.find((r) => r.number === round);
  if (target === undefined || target.stage !== 'swiss') {
    return [];
  }
  const records = playerRecords(state, round);
  const warnings: PairingWarning[] = [];
  for (const match of [...target.matches].sort((a, b) => a.table - b.table)) {
    const record = records[match.playerA];
    if (match.playerB === null) {
      if (record !== undefined && record.byes > 0) {
        warnings.push({ kind: 'repeatBye', matchId: match.matchId, playerId: match.playerA });
      }
    } else if (record?.opponents.includes(match.playerB)) {
      warnings.push({
        kind: 'rematch',
        matchId: match.matchId,
        playerA: match.playerA,
        playerB: match.playerB,
      });
    }
  }
  return warnings;
}

/** The same codes `validate` would return for the resulting `RoundPaired`. */
function checkPreconditions(state: TournamentState): DomainError | null {
  if (state.status !== 'setup' && state.status !== 'running') {
    return domainError(
      'WRONG_STATUS',
      `Swiss rounds cannot be paired while the tournament is ${state.status}`,
    );
  }
  const current = state.rounds.at(-1);
  if (current !== undefined && !current.closed) {
    return domainError(
      'ROUND_STILL_OPEN',
      `Round ${current.number} must be closed before pairing a new round`,
    );
  }
  // null only with fewer than 2 active players, which the next check rejects.
  const swissRounds = resolvedSwissRounds(state);
  const next = state.rounds.length + 1;
  if (swissRounds !== null && next > swissRounds) {
    return domainError('TOO_MANY_ROUNDS', `The tournament has only ${swissRounds} swiss rounds`);
  }
  if (activePlayerCount(state) < 2) {
    return domainError('INVALID_PAIRINGS', 'A swiss round needs at least 2 active players');
  }
  return null;
}

/** Lowest match points among players without a bye (everyone, if all had one); random ties. */
function pickBye(active: PlayerRecord[], random: () => number): PlayerRecord {
  const withoutBye = active.filter((record) => record.byes === 0);
  const candidates = withoutBye.length > 0 ? withoutBye : active;
  const lowest = Math.min(...candidates.map((record) => record.matchPoints));
  const tied = candidates.filter((record) => record.matchPoints === lowest);
  return tied[Math.floor(random() * tied.length)];
}

/** Fisher–Yates shuffle, then a stable sort by match points descending. */
function orderField(field: PlayerRecord[], random: () => number): PlayerRecord[] {
  const shuffled = [...field];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.sort((a, b) => b.matchPoints - a.matchPoints);
}

/**
 * Tries 0 allowed rematches, then 1, 2… up to `floor(n / 2)`, and returns the first pairing
 * found. An attempt that runs out of `SEARCH_BUDGET` steps counts as failed. With every
 * pairing allowed to be a rematch, the first branch succeeds, so this always returns.
 */
function pairWithFewestRematches(field: PlayerRecord[]): Array<[PlayerRecord, PlayerRecord]> {
  const opponents = field.map((record) => new Set(record.opponents));
  for (let allowed = 0; allowed <= Math.floor(field.length / 2); allowed++) {
    const pairs = search(field, opponents, allowed);
    if (pairs !== null) {
      return pairs.map(([i, j]) => [field[i], field[j]]);
    }
  }
  throw new Error('pairWithFewestRematches: unreachable');
}

/**
 * Backtracking: the first unpaired player takes the first possible opponent in list order
 * (same points first, then lower: the odd player floats down). Returns index pairs, or null
 * on a dead end or when the budget runs out.
 */
function search(
  field: PlayerRecord[],
  opponents: Set<Uuid>[],
  allowedRematches: number,
): Array<[number, number]> | null {
  const paired = new Array<boolean>(field.length).fill(false);
  const pairs: Array<[number, number]> = [];
  let steps = 0;

  function next(rematchesLeft: number): boolean {
    const i = paired.indexOf(false);
    if (i === -1) {
      return true;
    }
    paired[i] = true;
    for (let j = i + 1; j < field.length; j++) {
      if (paired[j]) {
        continue;
      }
      if (++steps > SEARCH_BUDGET) {
        return false;
      }
      const rematch = opponents[i].has(field[j].playerId);
      if (rematch && rematchesLeft === 0) {
        continue;
      }
      paired[j] = true;
      pairs.push([i, j]);
      if (next(rematchesLeft - (rematch ? 1 : 0))) {
        return true;
      }
      pairs.pop();
      paired[j] = false;
    }
    paired[i] = false;
    return false;
  }

  return next(allowedRematches) && steps <= SEARCH_BUDGET ? pairs : null;
}
