import type { Uuid } from './schemas/common';
import { lastClosedSwissRound, standings } from './standings';
import type { Match, TournamentState } from './state';
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
