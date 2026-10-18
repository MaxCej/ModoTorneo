import { describe, expect, it } from 'vitest';
import {
  CREATED_PAYLOAD,
  PLAYERS,
  TOURNAMENT_ID,
  WIN_A,
  addClosedRound,
  matchId,
  pairing,
  registeredLog,
  uuid,
} from './fixtures/builders';
import { matchPoints, playerRecords } from './points';
import { reduce } from './reduce';
import type { MatchOutcome, MatchResult } from './schemas/matchResult';

const [P1, P2, P3, P4, P5] = PLAYERS;

const result = (winsA: number, winsB: number, draws = 0): MatchResult => ({
  winsA,
  winsB,
  draws,
  kind: 'played',
});
const ID: MatchResult = { winsA: 0, winsB: 0, draws: 0, kind: 'intentionalDraw' };
const UNPLAYED: MatchResult = { winsA: 0, winsB: 0, draws: 0, kind: 'unplayed' };

/** 4 players, swiss round 1 (P1-P2, P3-P4) paired with `results`, then closed. */
function oneRound(results: [MatchResult, MatchResult]) {
  return registeredLog(4)
    .add('RoundPaired', {
      round: 1,
      stage: 'swiss',
      pairings: [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)],
    })
    .add('ResultReported', { matchId: matchId(1), result: results[0] })
    .add('ResultReported', { matchId: matchId(2), result: results[1] })
    .add('RoundClosed', { round: 1 });
}

const recordsOf = (log: ReturnType<typeof registeredLog>, beforeRound?: number) =>
  playerRecords(reduce(log.events, TOURNAMENT_ID), beforeRound);

describe('matchPoints', () => {
  it.each<[MatchOutcome, number, number]>([
    ['A', 3, 0],
    ['B', 0, 3],
    ['draw', 1, 1],
    ['doubleLoss', 0, 0],
  ])('gives %s → A %i, B %i', (outcome, a, b) => {
    expect(matchPoints(outcome, 'A')).toBe(a);
    expect(matchPoints(outcome, 'B')).toBe(b);
  });
});

describe('playerRecords', () => {
  it('scores a win, a loss and a played draw', () => {
    const records = recordsOf(oneRound([result(2, 1), result(1, 1, 1)]));
    expect(records[P1]).toEqual({
      playerId: P1,
      matchPoints: 3,
      wins: 1,
      losses: 0,
      draws: 0,
      byes: 0,
      opponents: [P2],
      gamesWon: 2,
      gamesLost: 1,
      gamesDrawn: 0,
    });
    expect(records[P2]).toMatchObject({ matchPoints: 0, wins: 0, losses: 1, opponents: [P1] });
    expect(records[P3]).toMatchObject({ matchPoints: 1, draws: 1, opponents: [P4] });
    expect(records[P4]).toMatchObject({ matchPoints: 1, draws: 1, opponents: [P3] });
  });

  it('scores a win for player B', () => {
    const records = recordsOf(oneRound([result(0, 2), result(1, 2)]));
    expect(records[P2]).toMatchObject({ matchPoints: 3, wins: 1 });
    expect(records[P4]).toMatchObject({ matchPoints: 3, wins: 1 });
    expect(records[P1]).toMatchObject({ matchPoints: 0, losses: 1 });
  });

  it('gives 1 point to each player for an intentional draw', () => {
    const records = recordsOf(oneRound([ID, WIN_A]));
    expect(records[P1]).toMatchObject({ matchPoints: 1, draws: 1 });
    expect(records[P2]).toMatchObject({ matchPoints: 1, draws: 1 });
  });

  it('counts an unplayed match as a loss for both players', () => {
    const records = recordsOf(oneRound([UNPLAYED, WIN_A]));
    expect(records[P1]).toMatchObject({ matchPoints: 0, losses: 1, opponents: [P2] });
    expect(records[P2]).toMatchObject({ matchPoints: 0, losses: 1, opponents: [P1] });
  });

  it('counts a bye as a 3-point win with no opponent', () => {
    const log = addClosedRound(registeredLog(3), 1, 'swiss', [
      pairing(1, 1, P1, P2),
      pairing(2, 2, P3, null),
    ]);
    expect(recordsOf(log)[P3]).toEqual({
      playerId: P3,
      matchPoints: 3,
      wins: 1,
      losses: 0,
      draws: 0,
      byes: 1,
      opponents: [],
      gamesWon: 2,
      gamesLost: 0,
      gamesDrawn: 0,
    });
  });

  it('counts games: a 2-1 for A, a 1-1-1 for both', () => {
    const records = recordsOf(oneRound([result(2, 1), result(1, 1, 1)]));
    const games = (id: string) => {
      const { gamesWon, gamesLost, gamesDrawn } = records[id];
      return [gamesWon, gamesLost, gamesDrawn];
    };
    expect(games(P1)).toEqual([2, 1, 0]);
    expect(games(P2)).toEqual([1, 2, 0]);
    expect(games(P3)).toEqual([1, 1, 1]);
    expect(games(P4)).toEqual([1, 1, 1]);
  });

  it('counts games for player B wins', () => {
    const records = recordsOf(oneRound([result(0, 2), result(1, 2, 1)]));
    expect(records[P2]).toMatchObject({ gamesWon: 2, gamesLost: 0, gamesDrawn: 0 });
    expect(records[P1]).toMatchObject({ gamesWon: 0, gamesLost: 2, gamesDrawn: 0 });
    expect(records[P4]).toMatchObject({ gamesWon: 2, gamesLost: 1, gamesDrawn: 1 });
  });

  it('adds no games for an intentional draw or an unplayed match', () => {
    const records = recordsOf(oneRound([ID, UNPLAYED]));
    for (const id of [P1, P2, P3, P4]) {
      expect(records[id]).toMatchObject({ gamesWon: 0, gamesLost: 0, gamesDrawn: 0 });
    }
  });

  it('ignores matches without a result in the open round', () => {
    const log = oneRound([WIN_A, WIN_A])
      .add('RoundPaired', {
        round: 2,
        stage: 'swiss',
        pairings: [pairing(3, 1, P1, P3), pairing(4, 2, P2, P4)],
      })
      .add('ResultReported', { matchId: matchId(3), result: WIN_A });
    const records = recordsOf(log);
    // Match 3 is reported, match 4 is not.
    expect(records[P1]).toMatchObject({ matchPoints: 6, opponents: [P2, P3] });
    expect(records[P2]).toMatchObject({ matchPoints: 0, opponents: [P1] });
    expect(records[P4]).toMatchObject({ matchPoints: 0, opponents: [P3] });
  });

  it('ignores top cut rounds', () => {
    const oneSwissRound = { ...CREATED_PAYLOAD, swissRounds: 1 };
    const log = addClosedRound(registeredLog(4, oneSwissRound), 1, 'swiss', [
      pairing(1, 1, P1, P2),
      pairing(2, 2, P3, P4),
    ]).add('TopCutStarted', { size: 4 });
    addClosedRound(log, 2, 'topCut', [pairing(3, 1, P1, P4), pairing(4, 2, P2, P3)]);

    const records = recordsOf(log);
    expect(records[P1]).toMatchObject({ matchPoints: 3, opponents: [P2] });
    expect(records[P2]).toMatchObject({ matchPoints: 0, opponents: [P1] });
  });

  it('counts only rounds before beforeRound', () => {
    const log = addClosedRound(oneRound([WIN_A, WIN_A]), 2, 'swiss', [
      pairing(3, 1, P1, P3),
      pairing(4, 2, P2, P4),
    ]);
    expect(recordsOf(log, 2)[P1]).toMatchObject({ matchPoints: 3, opponents: [P2] });
    expect(recordsOf(log, 1)[P1]).toMatchObject({ matchPoints: 0, opponents: [] });
    expect(recordsOf(log)[P1]).toMatchObject({ matchPoints: 6, opponents: [P2, P3] });
  });

  it('keeps entries for a dropped player and a late entry', () => {
    const late = uuid(150);
    const log = oneRound([WIN_A, WIN_A])
      .add('PlayerDropped', { playerId: P2 })
      .add('PlayerRegistered', { playerId: late, playerName: 'Late' });
    const records = recordsOf(log);

    expect(records[P2]).toMatchObject({ matchPoints: 0, losses: 1 });
    expect(records[late]).toEqual({
      playerId: late,
      matchPoints: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      byes: 0,
      opponents: [],
      gamesWon: 0,
      gamesLost: 0,
      gamesDrawn: 0,
    });
    expect(Object.keys(records)).toHaveLength(5);
    expect(records[P5]).toBeUndefined();
  });
});
