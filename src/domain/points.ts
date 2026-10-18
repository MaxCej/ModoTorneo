import type { Uuid } from './schemas/common';
import { matchOutcome, type MatchOutcome } from './schemas/matchResult';
import type { TournamentState } from './state';

/** A player's swiss results. MTR scoring: win 3, draw 1, loss 0. */
export type PlayerRecord = {
  playerId: Uuid;
  matchPoints: number;
  wins: number; // a bye counts as a win
  losses: number; // 'doubleLoss' (unplayed) counts as a loss for both players
  draws: number; // 'draw' and intentional draws
  byes: number;
  opponents: Uuid[]; // every opponent faced, in round order, byes excluded
  gamesWon: number; // a bye adds 2 (IMPLICIT_BYE_RESULT)
  gamesLost: number;
  gamesDrawn: number; // drawn games inside a played match; intentional draws and unplayed add none
};

/** Match points one side earns from an outcome. */
export function matchPoints(outcome: MatchOutcome, side: 'A' | 'B'): 0 | 1 | 3 {
  switch (outcome) {
    case 'A':
      return side === 'A' ? 3 : 0;
    case 'B':
      return side === 'B' ? 3 : 0;
    case 'draw':
      return 1;
    case 'doubleLoss':
      return 0;
  }
}

/**
 * Records from swiss matches with a result in rounds `< beforeRound` (default: every round).
 * Every registered player has an entry, dropped and late entries included. Top cut rounds and
 * matches without a result are ignored.
 */
export function playerRecords(
  state: TournamentState,
  beforeRound = Infinity,
): Record<Uuid, PlayerRecord> {
  const records: Record<Uuid, PlayerRecord> = {};
  for (const playerId of Object.keys(state.players)) {
    records[playerId] = {
      playerId,
      matchPoints: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      byes: 0,
      opponents: [],
      gamesWon: 0,
      gamesLost: 0,
      gamesDrawn: 0,
    };
  }

  for (const round of state.rounds) {
    if (round.stage !== 'swiss' || round.number >= beforeRound) {
      continue;
    }
    for (const match of round.matches) {
      if (match.result === null) {
        continue;
      }
      const { result } = match;
      const outcome = matchOutcome(result);
      const a = records[match.playerA];
      const b = match.playerB === null ? undefined : records[match.playerB];
      if (a !== undefined) {
        score(a, outcome, 'A');
        countGames(a, result.winsA, result.winsB, result.draws);
        if (match.playerB === null) {
          a.byes += 1;
        } else {
          a.opponents.push(match.playerB);
        }
      }
      if (b !== undefined) {
        score(b, outcome, 'B');
        countGames(b, result.winsB, result.winsA, result.draws);
        b.opponents.push(match.playerA);
      }
    }
  }
  return records;
}

function score(record: PlayerRecord, outcome: MatchOutcome, side: 'A' | 'B'): void {
  const points = matchPoints(outcome, side);
  record.matchPoints += points;
  if (points === 3) {
    record.wins += 1;
  } else if (points === 1) {
    record.draws += 1;
  } else {
    record.losses += 1;
  }
}

/** Intentional draws and unplayed matches are stored with 0 games, so they add none. */
function countGames(record: PlayerRecord, won: number, lost: number, drawn: number): void {
  record.gamesWon += won;
  record.gamesLost += lost;
  record.gamesDrawn += drawn;
}
