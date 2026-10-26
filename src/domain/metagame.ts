import { countPlayed, type GameCounts, type MatchCounts } from './playerStats';
import type { Format, IsoDate, Uuid } from './schemas/common';
import type { TournamentState } from './state';

/** Players of one archetype in one tournament. */
export type ArchetypeEntry = {
  archetype: string | null; // null: players without an archetype ("Unknown")
  players: number; // registered with it, guests and dropped included
  topCut: number; // of those, players in at least one top cut match
};

/** Matches between two archetypes, from `archetype`'s side. */
export type Matchup = MatchCounts & {
  archetype: string | null;
  opponent: string | null;
  games: GameCounts;
};

/** One tournament's metagame. Stored in the tournament summary. */
export type TournamentMetagame = {
  archetypes: ArchetypeEntry[]; // name order (English collation), Unknown last
  matchups: Matchup[]; // one row per ordered pair that met; each match is counted from both sides
};

const collator = new Intl.Collator('en');

/** Name order, Unknown (`null`) last. */
function compareLabels(a: string | null, b: string | null): number {
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? 1 : -1;
  }
  return collator.compare(a, b);
}

/**
 * Archetype entries and matchups of every registered player, guests and dropped players
 * included. Labels are grouped case-insensitively with the first spelling in registration
 * order. Swiss and top cut matches with a result count; byes and unplayed matches do not.
 */
export function tournamentMetagame(state: TournamentState): TournamentMetagame {
  const spellings = new Map<string, string>();
  const archetypeOf = new Map<Uuid, string | null>();
  for (const player of Object.values(state.players)) {
    const label = player.deck?.archetype;
    if (label === undefined) {
      archetypeOf.set(player.playerId, null);
      continue;
    }
    const key = label.toLowerCase();
    const spelling = spellings.get(key) ?? label;
    spellings.set(key, spelling);
    archetypeOf.set(player.playerId, spelling);
  }

  const inTopCut = new Set<Uuid>();
  const matchups = new Map<string, Matchup>();
  for (const round of state.rounds) {
    for (const match of round.matches) {
      if (round.stage === 'topCut') {
        inTopCut.add(match.playerA);
        if (match.playerB !== null) {
          inTopCut.add(match.playerB);
        }
      }
      const { playerB, result } = match;
      if (playerB === null || result === null || result.kind === 'unplayed') {
        continue;
      }
      for (const side of ['A', 'B'] as const) {
        const archetype = archetypeOf.get(side === 'A' ? match.playerA : playerB) ?? null;
        const opponent = archetypeOf.get(side === 'A' ? playerB : match.playerA) ?? null;
        const key = JSON.stringify([archetype, opponent]);
        let matchup = matchups.get(key);
        if (matchup === undefined) {
          matchup = {
            archetype,
            opponent,
            wins: 0,
            losses: 0,
            draws: 0,
            games: { won: 0, lost: 0, drawn: 0 },
          };
          matchups.set(key, matchup);
        }
        countPlayed(matchup, match, side);
      }
    }
  }

  const entries = new Map<string | null, ArchetypeEntry>();
  for (const [playerId, archetype] of archetypeOf) {
    let entry = entries.get(archetype);
    if (entry === undefined) {
      entry = { archetype, players: 0, topCut: 0 };
      entries.set(archetype, entry);
    }
    entry.players += 1;
    if (inTopCut.has(playerId)) {
      entry.topCut += 1;
    }
  }

  return {
    archetypes: [...entries.values()].sort((a, b) => compareLabels(a.archetype, b.archetype)),
    matchups: [...matchups.values()].sort(
      (a, b) => compareLabels(a.archetype, b.archetype) || compareLabels(a.opponent, b.opponent),
    ),
  };
}

/** The summary fields aggregation needs. `TournamentSummary` is assignable to it. */
export type MetagameSource = {
  id: Uuid;
  date: IsoDate;
  format: Format;
  metagame: TournamentMetagame;
};

export type MetagameFilters = { format: Format; from: IsoDate | null; to: IsoDate | null };

export type ArchetypeStats = {
  archetype: string | null; // null: Unknown, and Other
  players: number;
  share: number; // fraction in [0, 1]
  matches: MatchCounts; // mirrors excluded
  games: GameCounts; // mirrors excluded
  matchWinRate: number | null;
  gameWinRate: number | null;
  topCut: number;
};

export type MetagameGroup =
  | { kind: 'archetype'; stats: ArchetypeStats }
  | { kind: 'other'; members: number; stats: ArchetypeStats } // stats.archetype is null
  | { kind: 'unknown'; stats: ArchetypeStats };

export type MatrixCell =
  | { kind: 'none' } // the groups never met
  | { kind: 'mirror'; matches: number } // diagonal: matches inside the group, each counted once
  | ({ kind: 'matchup'; winRate: number } & MatchCounts); // row group's side

export type MetagameReport = {
  tournaments: number; // counted
  skipped: number; // in format and range, but no player has an archetype
  players: number;
  archetypes: ArchetypeStats[]; // every archetype, players descending then name; Unknown last
  groups: MetagameGroup[]; // the 8 most played, then Other (more than 8), then Unknown
  matrix: MatrixCell[][]; // matrix[row][column], indexed like `groups`
};

/** Archetypes with a group of their own; the rest merge into Other. */
export const METAGAME_GROUPS = 8;

/** Grouping key: the lower-cased label, `null` for Unknown. */
type Key = string | null;

type Counts = MatchCounts & { games: GameCounts };

const emptyCounts = (): Counts => ({
  wins: 0,
  losses: 0,
  draws: 0,
  games: { won: 0, lost: 0, drawn: 0 },
});

function addCounts(target: Counts, source: Counts): void {
  target.wins += source.wins;
  target.losses += source.losses;
  target.draws += source.draws;
  target.games.won += source.games.won;
  target.games.lost += source.games.lost;
  target.games.drawn += source.games.drawn;
}

const played = (m: MatchCounts) => m.wins + m.losses + m.draws;
const rate = (part: number, whole: number) => (whole === 0 ? null : part / whole);
const hasArchetype = (metagame: TournamentMetagame) =>
  metagame.archetypes.some((entry) => entry.archetype !== null);

/**
 * Archetype stats, groups and matchup matrix of the tournaments with `filters.format` and a
 * date inside the range (inclusive). Tournaments where no player has an archetype are skipped.
 * Inputs in date-descending order (the `listTournaments` order), so the most recent spelling wins.
 */
export function metagameReport(
  tournaments: readonly MetagameSource[],
  filters: MetagameFilters,
): MetagameReport {
  const { format, from, to } = filters;
  const spellings = new Map<string, string>();
  const keyOf = (label: string | null): Key => {
    if (label === null) {
      return null;
    }
    const key = label.toLowerCase();
    if (!spellings.has(key)) {
      spellings.set(key, label);
    }
    return key;
  };

  let counted = 0;
  let skipped = 0;
  let totalPlayers = 0;
  const entries = new Map<Key, { players: number; topCut: number }>();
  const pairs = new Map<Key, Map<Key, Counts>>();
  for (const tournament of tournaments) {
    if (
      tournament.format !== format ||
      (from !== null && tournament.date < from) ||
      (to !== null && tournament.date > to)
    ) {
      continue;
    }
    if (!hasArchetype(tournament.metagame)) {
      skipped += 1;
      continue;
    }
    counted += 1;
    for (const entry of tournament.metagame.archetypes) {
      const key = keyOf(entry.archetype);
      const total = entries.get(key) ?? { players: 0, topCut: 0 };
      total.players += entry.players;
      total.topCut += entry.topCut;
      entries.set(key, total);
      totalPlayers += entry.players;
    }
    for (const matchup of tournament.metagame.matchups) {
      const row = keyOf(matchup.archetype);
      const column = keyOf(matchup.opponent);
      const byColumn = pairs.get(row) ?? new Map<Key, Counts>();
      pairs.set(row, byColumn);
      const counts = byColumn.get(column) ?? emptyCounts();
      byColumn.set(column, counts);
      addCounts(counts, matchup);
    }
  }

  /** Matches of `rows` against `columns` from the rows' side; `mirrors: false` drops (k, k). */
  const sum = (rows: readonly Key[], columns: readonly Key[], mirrors: boolean): Counts => {
    const total = emptyCounts();
    for (const row of rows) {
      for (const column of columns) {
        const counts = pairs.get(row)?.get(column);
        if (counts !== undefined && (mirrors || row !== column)) {
          addCounts(total, counts);
        }
      }
    }
    return total;
  };

  const known = [...entries.keys()].filter((key) => key !== null);
  const labelOf = (key: string) => spellings.get(key) ?? key;
  const playersOf = (key: Key) => entries.get(key)?.players ?? 0;
  known.sort((a, b) => playersOf(b) - playersOf(a) || collator.compare(labelOf(a), labelOf(b)));
  const allKeys: Key[] = [...known, null];

  /** Stats of a set of keys: matches between different members count, member mirrors do not. */
  const statsOf = (members: readonly Key[], archetype: string | null): ArchetypeStats => {
    const players = members.reduce((total, key) => total + playersOf(key), 0);
    const topCut = members.reduce((total, key) => total + (entries.get(key)?.topCut ?? 0), 0);
    const { games, ...matches } = sum(members, allKeys, false);
    return {
      archetype,
      players,
      share: rate(players, totalPlayers) ?? 0,
      matches,
      games,
      matchWinRate: rate(matches.wins, played(matches)),
      gameWinRate: rate(games.won, games.won + games.lost + games.drawn),
      topCut,
    };
  };

  const archetypes = known.map((key) => statsOf([key], labelOf(key)));
  const groups: MetagameGroup[] = archetypes
    .slice(0, METAGAME_GROUPS)
    .map((stats) => ({ kind: 'archetype', stats }));
  const groupKeys: Key[][] = known.slice(0, METAGAME_GROUPS).map((key) => [key]);
  const rest = known.slice(METAGAME_GROUPS);
  if (rest.length > 0) {
    groups.push({ kind: 'other', members: rest.length, stats: statsOf(rest, null) });
    groupKeys.push(rest);
  }
  if (playersOf(null) > 0) {
    const unknown = statsOf([null], null);
    archetypes.push(unknown);
    groups.push({ kind: 'unknown', stats: unknown });
    groupKeys.push([null]);
  }

  const matrix = groupKeys.map((rows, i) =>
    groupKeys.map((columns, j): MatrixCell => {
      const counts = sum(rows, columns, true);
      const matches = played(counts);
      if (matches === 0) {
        return { kind: 'none' };
      }
      if (i === j) {
        // Both sides of every match inside the group land in this cell.
        return { kind: 'mirror', matches: matches / 2 };
      }
      const { wins, losses, draws } = counts;
      return { kind: 'matchup', winRate: wins / matches, wins, losses, draws };
    }),
  );

  return { tournaments: counted, skipped, players: totalPlayers, archetypes, groups, matrix };
}

/** Format of the most recent tournament where a player has an archetype, or null. */
export function defaultMetagameFormat(tournaments: readonly MetagameSource[]): Format | null {
  return tournaments.find((t) => hasArchetype(t.metagame))?.format ?? null;
}
