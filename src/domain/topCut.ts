import type { TopCutSize, Uuid } from './schemas/common';
import { standings, type Standing } from './standings';
import type { TournamentState } from './state';

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
