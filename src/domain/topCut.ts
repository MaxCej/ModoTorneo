import { executeAll, type Command, type Deps } from './commands';
import { domainError, type DomainError } from './errors';
import { newId } from './ids';
import type { PairingDeps } from './pairing';
import { err, ok, type Result } from './result';
import type { BestOf, TopCutSize, Uuid } from './schemas/common';
import type { TournamentDocument } from './schemas/document';
import type { Pairing, RoundPairedPayload } from './schemas/events';
import { standings, type Standing } from './standings';
import { matchWinner, type Round, type TournamentState } from './state';

/** Name of a top cut round, from its number of matches. */
export type TopCutRoundName = 'final' | 'semifinals' | 'quarterfinals' | 'roundOf16' | 'roundOf32';

const ROUND_NAMES: Record<number, TopCutRoundName> = {
  1: 'final',
  2: 'semifinals',
  4: 'quarterfinals',
  8: 'roundOf16',
  16: 'roundOf32',
};

/** A seed candidate: a standings row and the other active players sharing its rank. */
export type SeedCandidate = Standing & { tiedWith: Uuid[] };

export type SeedPreview = {
  seeds: SeedCandidate[]; // the top `size` active players by standings, before the tie-break
  tieAtCutLine: Uuid[]; // active players sharing the rank of the last seed, when it spans the cut
};

/** Recommended top cut size: <8 active: none; 8–16: 4; 17–32: 8; 33–64: 16; 65+: 32. */
export function defaultTopCutSize(activePlayers: number): TopCutSize | null {
  if (activePlayers < 8) return null;
  if (activePlayers <= 16) return 4;
  if (activePlayers <= 32) return 8;
  if (activePlayers <= 64) return 16;
  return 32;
}

/**
 * The seed in each bracket slot, so seeds 1 and 2 can only meet in the final.
 * Top 4: `[1, 4, 2, 3]`. Top 8: `[1, 8, 4, 5, 2, 7, 3, 6]`.
 */
export function bracketOrder(size: TopCutSize): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((seed) => [seed, n + 1 - seed]);
  }
  return order;
}

/** Throws for a match count that no top cut round can have (validated logs never do). */
export function topCutRoundName(matches: number): TopCutRoundName {
  const name = ROUND_NAMES[matches] as TopCutRoundName | undefined;
  if (name === undefined) {
    throw new Error(`No top cut round has ${matches} matches`);
  }
  return name;
}

/** Standings after the last closed swiss round, active players only. */
function activeStandings(state: TournamentState): Standing[] {
  return standings(state).filter((row) => !row.dropped);
}

/** The top `size` active players by standings, with their ties, before the random tie-break. */
export function seedPreview(state: TournamentState, size: TopCutSize): SeedPreview {
  const rows = activeStandings(state);
  const seeds = rows.slice(0, size).map((row) => ({
    ...row,
    tiedWith: rows
      .filter((other) => other.rank === row.rank && other.playerId !== row.playerId)
      .map((other) => other.playerId),
  }));
  const last = rows.at(size - 1);
  const next = rows.at(size);
  const tieAtCutLine =
    last !== undefined && next !== undefined && last.rank === next.rank
      ? rows.filter((row) => row.rank === last.rank).map((row) => row.playerId)
      : [];
  return { seeds, tieAtCutLine };
}

/**
 * Seeds for the first top cut round, best first. Players sharing a rank are ordered with
 * `random` (Fisher–Yates), including a tie across the cut line.
 */
export function topCutSeeds(
  state: TournamentState,
  size: TopCutSize,
  random: () => number,
): Uuid[] {
  const groups: Uuid[][] = [];
  let previousRank: number | null = null;
  for (const row of activeStandings(state)) {
    if (row.rank !== previousRank) {
      groups.push([]);
      previousRank = row.rank;
    }
    groups[groups.length - 1].push(row.playerId);
  }
  return groups.flatMap((group) => shuffle(group, random)).slice(0, size);
}

/** Fisher–Yates. A group of one consumes no random numbers. */
function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const defaultDeps: Deps & PairingDeps = {
  now: () => new Date().toISOString(),
  newId,
  random: Math.random,
};

/**
 * Next top cut round: the first round from `topCutSeeds`, a later round from the winners of the
 * previous top cut round. The better seed is `playerA`. The payload always passes `validate`.
 * Errors: WRONG_STATUS (status not topCut), ROUND_STILL_OPEN, INVALID_PAIRINGS (final played).
 */
export function pairTopCutRound(
  state: TournamentState,
  deps: PairingDeps = defaultDeps,
): Result<RoundPairedPayload, DomainError> {
  if (state.status !== 'topCut' || state.topCut === null) {
    return err(domainError('WRONG_STATUS', `Cannot pair a top cut round while ${state.status}`));
  }
  const current = state.rounds.at(-1);
  if (current !== undefined && !current.closed) {
    return err(domainError('ROUND_STILL_OPEN', `Round ${current.number} is still open`));
  }
  const pairs = nextTopCutPairs(state, state.topCut, deps.random);
  if (!pairs.ok) {
    return pairs;
  }
  const pairings: Pairing[] = pairs.value.map(([a, b], i) => ({
    matchId: deps.newId(),
    table: i + 1,
    playerA: a,
    playerB: b,
  }));
  return ok({ round: state.rounds.length + 1, stage: 'topCut', pairings });
}

/** Player pairs of the next top cut round, in table order, better seed first. */
function nextTopCutPairs(
  state: TournamentState,
  size: TopCutSize,
  random: () => number,
): Result<[Uuid, Uuid][], DomainError> {
  const order = bracketOrder(size);
  const topCutRounds = state.rounds.filter((round) => round.stage === 'topCut');
  const previous = topCutRounds.at(-1);
  if (previous === undefined) {
    const seeds = topCutSeeds(state, size, random);
    const pairs: [Uuid, Uuid][] = [];
    for (let slot = 0; slot < size; slot += 2) {
      const [high, low] = [order[slot], order[slot + 1]].sort((a, b) => a - b);
      pairs.push([seeds[high - 1], seeds[low - 1]]);
    }
    return ok(pairs);
  }
  if (previous.matches.length === 1) {
    return err(domainError('INVALID_PAIRINGS', 'The final has been played'));
  }
  const seedOf = seedsFromFirstRound(topCutRounds[0], order);
  const winnerAt = (table: number) => {
    const match = previous.matches.find((m) => m.table === table);
    return match === undefined ? null : matchWinner(match);
  };
  const pairs: [Uuid, Uuid][] = [];
  for (let table = 1; table <= previous.matches.length / 2; table++) {
    const a = winnerAt(2 * table - 1);
    const b = winnerAt(2 * table);
    if (a === null || b === null) {
      return err(
        domainError('INVALID_PAIRINGS', `Round ${previous.number} has a match without a winner`),
      );
    }
    pairs.push(seedOf[a] <= seedOf[b] ? [a, b] : [b, a]);
  }
  return ok(pairs);
}

/** Seed of each player from the slot of their table and side in the first top cut round. */
function seedsFromFirstRound(first: Round, order: number[]): Record<Uuid, number> {
  const seedOf: Record<Uuid, number> = {};
  for (const match of first.matches) {
    seedOf[match.playerA] = order[2 * match.table - 2];
    if (match.playerB !== null) {
      seedOf[match.playerB] = order[2 * match.table - 1];
    }
  }
  return seedOf;
}

/** `[TopCutStarted, RoundPaired]` for the first top cut round, validated as a dry run. */
export function startTopCutCommands(
  doc: TournamentDocument,
  size: TopCutSize,
  bestOf: BestOf,
  deps: Deps & PairingDeps = defaultDeps,
): Result<[Command, Command], DomainError> {
  const start: Command = { type: 'TopCutStarted', payload: { size, bestOf } };
  const started = executeAll(doc, [start], deps);
  if (!started.ok) {
    return started;
  }
  const paired = pairTopCutRound(started.value.state, deps);
  if (!paired.ok) {
    return paired;
  }
  const commands: [Command, Command] = [start, { type: 'RoundPaired', payload: paired.value }];
  const checked = executeAll(doc, commands, deps);
  return checked.ok ? ok(commands) : checked;
}
