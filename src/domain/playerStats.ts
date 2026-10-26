import { FormatSchema, type Format, type IsoDate, type Uuid } from './schemas/common';
import { lastClosedSwissRound, standings } from './standings';
import type { Match, TournamentState, TournamentStatus } from './state';
import { topCutPlacings } from './topCut';

export type MatchCounts = { wins: number; losses: number; draws: number };
export type GameCounts = { won: number; lost: number; drawn: number };

type StageResult = MatchCounts & { games: GameCounts };

/** One registry player's result in one tournament. Stored in the tournament summary. */
export type PlayerResult = {
  playerId: Uuid;
  playerName: string; // snapshot from the tournament (PlayerEntry.playerName)
  dropped: boolean;
  swiss: StageResult & { byes: number; unplayed: number };
  topCut: StageResult | null; // null when the player is in no top cut match
  swissRank: number | null;
  placing: { from: number; to: number } | null;
  archetype: string | null; // PlayerEntry.deck?.archetype
};

const emptyStage = (): StageResult => ({
  wins: 0,
  losses: 0,
  draws: 0,
  games: { won: 0, lost: 0, drawn: 0 },
});

/**
 * Non-guest players of the state, sorted by playerId. Swiss and top cut matches with a result
 * count; byes and unplayed matches are counted on their own and add no match or game.
 */
export function playerResults(state: TournamentState): PlayerResult[] {
  const results: Record<Uuid, PlayerResult> = {};
  for (const player of Object.values(state.players)) {
    if (player.guest) {
      continue;
    }
    results[player.playerId] = {
      playerId: player.playerId,
      playerName: player.playerName,
      dropped: player.dropped,
      swiss: { ...emptyStage(), byes: 0, unplayed: 0 },
      topCut: null,
      swissRank: null,
      placing: null,
      archetype: player.deck?.archetype ?? null,
    };
  }

  for (const round of state.rounds) {
    for (const match of round.matches) {
      for (const side of ['A', 'B'] as const) {
        const playerId = side === 'A' ? match.playerA : match.playerB;
        const result = playerId === null ? undefined : results[playerId];
        if (result === undefined) {
          continue;
        }
        if (round.stage === 'swiss') {
          countSwiss(result.swiss, match, side);
        } else {
          result.topCut ??= emptyStage();
          countPlayed(result.topCut, match, side);
        }
      }
    }
  }

  if (lastClosedSwissRound(state) > 0) {
    for (const standing of standings(state)) {
      const result = results[standing.playerId];
      if (result !== undefined) {
        result.swissRank = standing.rank;
      }
    }
  }
  for (const { playerId, from, to } of topCutPlacings(state)) {
    const result = results[playerId];
    if (result !== undefined) {
      result.placing = { from, to };
    }
  }

  return Object.values(results).sort((a, b) =>
    a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0,
  );
}

function countSwiss(stage: PlayerResult['swiss'], match: Match, side: 'A' | 'B'): void {
  if (match.playerB === null) {
    stage.byes += 1;
  } else if (match.result?.kind === 'unplayed') {
    stage.unplayed += 1;
  } else {
    countPlayed(stage, match, side);
  }
}

/** Adds a reported match from `side`'s view. Intentional draws are stored with 0 games. */
function countPlayed(stage: StageResult, match: Match, side: 'A' | 'B'): void {
  const { result } = match;
  if (result === null || result.kind === 'unplayed') {
    return;
  }
  const won = side === 'A' ? result.winsA : result.winsB;
  const lost = side === 'A' ? result.winsB : result.winsA;
  if (won > lost) {
    stage.wins += 1;
  } else if (lost > won) {
    stage.losses += 1;
  } else {
    stage.draws += 1;
  }
  stage.games.won += won;
  stage.games.lost += lost;
  stage.games.drawn += result.draws;
}

/** The summary fields aggregation needs. `TournamentSummary` is assignable to it. */
export type TournamentResults = {
  id: Uuid;
  name: string;
  date: IsoDate;
  format: Format;
  status: TournamentStatus;
  playerCount: number;
  players: PlayerResult[];
};

export type PlayerTotals = {
  tournaments: number;
  matches: MatchCounts; // swiss + top cut
  games: GameCounts; // swiss + top cut
  byes: number;
  topCuts: number; // tournaments where topCut !== null
  matchWinRate: number | null; // fraction in [0, 1]
  gameWinRate: number | null;
  lastPlayed: IsoDate | null; // latest tournament date
};

export type PlayerHistoryRow = Omit<TournamentResults, 'players'> & { result: PlayerResult };

export type PlayerProfile = {
  totals: PlayerTotals;
  byFormat: (PlayerTotals & { format: Format })[]; // formats played only, FormatSchema order
  history: PlayerHistoryRow[]; // date descending, then name (English collation), then id
  bestPlacing: { from: number; to: number } | null; // lowest `from`, then lowest `to`
};

const nameCollator = new Intl.Collator('en');

/** Totals for every player found in the tournaments, keyed by playerId. */
export function playerTotals(
  tournaments: readonly TournamentResults[],
): Record<Uuid, PlayerTotals> {
  const byPlayer: Record<Uuid, PlayerHistoryRow[]> = {};
  for (const tournament of tournaments) {
    for (const result of tournament.players) {
      (byPlayer[result.playerId] ??= []).push(historyRow(tournament, result));
    }
  }
  const totals: Record<Uuid, PlayerTotals> = {};
  for (const [playerId, rows] of Object.entries(byPlayer)) {
    totals[playerId] = sumRows(rows);
  }
  return totals;
}

/** A player with no tournaments gets zero totals, empty lists and null rates. */
export function playerProfile(
  playerId: Uuid,
  tournaments: readonly TournamentResults[],
): PlayerProfile {
  const history: PlayerHistoryRow[] = [];
  for (const tournament of tournaments) {
    const result = tournament.players.find((r) => r.playerId === playerId);
    if (result !== undefined) {
      history.push(historyRow(tournament, result));
    }
  }
  history.sort(
    (a, b) =>
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
      nameCollator.compare(a.name, b.name) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const byFormat = FormatSchema.options.flatMap((format) => {
    const rows = history.filter((row) => row.format === format);
    return rows.length === 0 ? [] : [{ ...sumRows(rows), format }];
  });

  let bestPlacing: PlayerProfile['bestPlacing'] = null;
  for (const { result } of history) {
    const { placing } = result;
    if (
      placing !== null &&
      (bestPlacing === null ||
        placing.from < bestPlacing.from ||
        (placing.from === bestPlacing.from && placing.to < bestPlacing.to))
    ) {
      bestPlacing = { from: placing.from, to: placing.to };
    }
  }

  return { totals: sumRows(history), byFormat, history, bestPlacing };
}

function historyRow(tournament: TournamentResults, result: PlayerResult): PlayerHistoryRow {
  const { id, name, date, format, status, playerCount } = tournament;
  return { id, name, date, format, status, playerCount, result };
}

function sumRows(rows: readonly PlayerHistoryRow[]): PlayerTotals {
  const matches: MatchCounts = { wins: 0, losses: 0, draws: 0 };
  const games: GameCounts = { won: 0, lost: 0, drawn: 0 };
  let byes = 0;
  let topCuts = 0;
  let lastPlayed: IsoDate | null = null;
  for (const { date, result } of rows) {
    for (const stage of result.topCut === null ? [result.swiss] : [result.swiss, result.topCut]) {
      matches.wins += stage.wins;
      matches.losses += stage.losses;
      matches.draws += stage.draws;
      games.won += stage.games.won;
      games.lost += stage.games.lost;
      games.drawn += stage.games.drawn;
    }
    byes += result.swiss.byes;
    if (result.topCut !== null) {
      topCuts += 1;
    }
    if (lastPlayed === null || date > lastPlayed) {
      lastPlayed = date;
    }
  }
  return {
    tournaments: rows.length,
    matches,
    games,
    byes,
    topCuts,
    matchWinRate: rate(matches.wins, matches.wins + matches.losses + matches.draws),
    gameWinRate: rate(games.won, games.won + games.lost + games.drawn),
    lastPlayed,
  };
}

function rate(won: number, total: number): number | null {
  return total === 0 ? null : won / total;
}
