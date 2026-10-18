import { domainError, type DomainError } from './errors';
import { newId } from './ids';
import { playerRecords, type PlayerRecord } from './points';
import { err, ok, type Result } from './result';
import type { Uuid } from './schemas/common';
import type { Pairing, RoundPairedPayload } from './schemas/events';
import { activePlayerCount, type TournamentState } from './state';
import { resolvedSwissRounds } from './validate';

/** `random` returns a number in [0, 1), like `Math.random`. */
export type PairingDeps = { random: () => number; newId: () => Uuid };

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
  const pairs = pairInOrder(field);

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

/** Pairs neighbours in list order: 1 vs 2, 3 vs 4… */
function pairInOrder(field: PlayerRecord[]): Array<[PlayerRecord, PlayerRecord]> {
  const pairs: Array<[PlayerRecord, PlayerRecord]> = [];
  for (let i = 0; i + 1 < field.length; i += 2) {
    pairs.push([field[i], field[i + 1]]);
  }
  return pairs;
}
