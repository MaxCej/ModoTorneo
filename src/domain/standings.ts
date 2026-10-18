import type { Uuid } from './schemas/common';
import { playerRecords, type PlayerRecord } from './points';
import type { TournamentState } from './state';

/** MTR Appendix C: a player's MW% and GW% are never below 33%. */
export const PERCENTAGE_FLOOR = 0.33;

/** A player's record and MTR tiebreakers. Percentages are fractions in `[0, 1]`. */
export type Tiebreakers = {
  playerId: Uuid;
  matchPoints: number;
  wins: number;
  losses: number;
  draws: number;
  matchWinPct: number; // own MW%, floored; used for opponents' OMW%
  opponentMatchWinPct: number; // OMW%
  gameWinPct: number; // GW%, floored
  opponentGameWinPct: number; // OGW%
};

/** One ranked row of the swiss standings. */
export type Standing = Tiebreakers & {
  rank: number; // 1-based; shared on a full tie: 1, 2, 2, 4
  playerName: string;
  dropped: boolean;
};

/** Percentages closer than this are equal, so floating-point noise never splits a tie. */
const TOLERANCE = 1e-9;

const nameCollator = new Intl.Collator('en');

/** Highest closed swiss round number, or 0 when none is closed. */
export function lastClosedSwissRound(state: TournamentState): number {
  let last = 0;
  for (const round of state.rounds) {
    if (round.stage === 'swiss' && round.closed) {
      last = Math.max(last, round.number);
    }
  }
  return last;
}

/**
 * Unranked tiebreakers for every registered player, from closed swiss rounds `<= throughRound`
 * (default: lastClosedSwissRound). Rounds that are not closed never count.
 */
export function tiebreakers(
  state: TournamentState,
  throughRound?: number,
): Record<Uuid, Tiebreakers> {
  const last = lastClosedSwissRound(state);
  // Rounds close in order, so every swiss round up to `last` is closed and the open round is above it.
  const through = Math.min(throughRound ?? last, last);
  const records = playerRecords(state, through + 1);

  const matchWin: Record<Uuid, number> = {};
  const gameWin: Record<Uuid, number> = {};
  for (const record of Object.values(records)) {
    matchWin[record.playerId] = matchWinPct(record);
    gameWin[record.playerId] = gameWinPct(record);
  }

  const result: Record<Uuid, Tiebreakers> = {};
  for (const record of Object.values(records)) {
    const { playerId, matchPoints, wins, losses, draws, opponents } = record;
    result[playerId] = {
      playerId,
      matchPoints,
      wins,
      losses,
      draws,
      matchWinPct: matchWin[playerId],
      opponentMatchWinPct: opponentAverage(opponents, matchWin),
      gameWinPct: gameWin[playerId],
      opponentGameWinPct: opponentAverage(opponents, gameWin),
    };
  }
  return result;
}

/**
 * Ranked swiss standings after closed swiss rounds `<= throughRound`
 * (default: lastClosedSwissRound). Rounds that are not closed never count.
 * Every registered player is a row, dropped players and late entries included.
 */
export function standings(state: TournamentState, throughRound?: number): Standing[] {
  const rows = Object.values(tiebreakers(state, throughRound)).map((row) => {
    const player = state.players[row.playerId];
    return { ...row, playerName: player.playerName, dropped: player.dropped };
  });
  return rankStandings(rows);
}

/**
 * Orders rows by MP, OMW%, GW%, OGW% (all descending). A full tie shares the rank, the next rank
 * skips (1, 2, 2, 4), and tied rows are in name order, then by player id.
 */
export function rankStandings(rows: Omit<Standing, 'rank'>[]): Standing[] {
  const sorted = [...rows].sort(
    (a, b) =>
      compareTiebreakers(a, b) ||
      nameCollator.compare(a.playerName, b.playerName) ||
      (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
  );
  const ranked: Standing[] = [];
  for (const [i, row] of sorted.entries()) {
    const previous = ranked.at(-1);
    const rank =
      previous !== undefined && compareTiebreakers(previous, row) === 0 ? previous.rank : i + 1;
    ranked.push({ ...row, rank });
  }
  return ranked;
}

/** Negative when `a` ranks above `b`, 0 on a full tie. */
function compareTiebreakers(a: Tiebreakers, b: Tiebreakers): number {
  if (a.matchPoints !== b.matchPoints) {
    return b.matchPoints - a.matchPoints;
  }
  for (const key of ['opponentMatchWinPct', 'gameWinPct', 'opponentGameWinPct'] as const) {
    if (Math.abs(a[key] - b[key]) >= TOLERANCE) {
      return b[key] - a[key];
    }
  }
  return 0;
}

/** MW%: match points over 3 per round played (byes included), floored. */
function matchWinPct(record: PlayerRecord): number {
  const rounds = record.wins + record.losses + record.draws;
  return rounds === 0 ? PERCENTAGE_FLOOR : floored(record.matchPoints / (3 * rounds));
}

/** GW%: game points (3 per win, 1 per drawn game) over 3 per game played, floored. */
function gameWinPct(record: PlayerRecord): number {
  const games = record.gamesWon + record.gamesLost + record.gamesDrawn;
  return games === 0
    ? PERCENTAGE_FLOOR
    : floored((3 * record.gamesWon + record.gamesDrawn) / (3 * games));
}

/** Mean of the opponents' floored values, one entry per match. No opponents gives the floor. */
function opponentAverage(opponents: Uuid[], values: Record<Uuid, number>): number {
  if (opponents.length === 0) {
    return PERCENTAGE_FLOOR;
  }
  let sum = 0;
  for (const opponent of opponents) {
    sum += values[opponent];
  }
  return sum / opponents.length;
}

function floored(value: number): number {
  return Math.max(PERCENTAGE_FLOOR, value);
}
