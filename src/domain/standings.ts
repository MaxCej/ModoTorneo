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
