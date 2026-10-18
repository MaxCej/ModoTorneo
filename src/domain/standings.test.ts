import { describe, expect, it } from 'vitest';
import {
  CREATED_PAYLOAD,
  PLAYERS,
  TOURNAMENT_ID,
  WIN_A,
  addClosedRound,
  logBuilder,
  matchId,
  pairing,
  registeredLog,
  swissHistory,
  uuid,
  type LogBuilder,
} from './fixtures/builders';
import { reduce } from './reduce';
import type { MatchResult } from './schemas/matchResult';
import {
  PERCENTAGE_FLOOR,
  lastClosedSwissRound,
  rankStandings,
  standings,
  tiebreakers,
  type Standing,
} from './standings';

const [P1, P2, P3, P4, P5, P6, P7, P8] = PLAYERS;

const played = (winsA: number, winsB: number, draws = 0): MatchResult => ({
  winsA,
  winsB,
  draws,
  kind: 'played',
});
const WIN_B = played(1, 2);
const ID: MatchResult = { winsA: 0, winsB: 0, draws: 0, kind: 'intentionalDraw' };

const stateOf = (log: LogBuilder) => reduce(log.events, TOURNAMENT_ID);

describe('lastClosedSwissRound', () => {
  it('is 0 with no closed round', () => {
    expect(lastClosedSwissRound(stateOf(registeredLog(4)))).toBe(0);
    const open = registeredLog(4).add('RoundPaired', {
      round: 1,
      stage: 'swiss',
      pairings: [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)],
    });
    expect(lastClosedSwissRound(stateOf(open))).toBe(0);
  });

  it('ignores the open round', () => {
    const log = swissHistory(PLAYERS.slice(0, 4), [
      [
        [P1, P2],
        [P3, P4],
      ],
    ]).add('RoundPaired', {
      round: 2,
      stage: 'swiss',
      pairings: [pairing(3, 1, P1, P3), pairing(4, 2, P2, P4)],
    });
    expect(lastClosedSwissRound(stateOf(log))).toBe(1);
  });

  it('ignores top cut rounds', () => {
    const log = addClosedRound(
      registeredLog(4, { ...CREATED_PAYLOAD, swissRounds: 1 }),
      1,
      'swiss',
      [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)],
    ).add('TopCutStarted', { size: 4 });
    addClosedRound(log, 2, 'topCut', [pairing(3, 1, P1, P4), pairing(4, 2, P2, P3)]);
    expect(lastClosedSwissRound(stateOf(log))).toBe(1);
  });
});

describe('tiebreakers', () => {
  it('floors MW% and GW% at 33%', () => {
    // P2 loses 0-2, 1-2, 1-2: MW% 0 and GW% 6 / 24 = 0.25, both floored to 0.33.
    const log = swissHistory(PLAYERS.slice(0, 4), [
      [
        [P1, P2, played(2, 0)],
        [P3, P4],
      ],
      [
        [P1, P3],
        [P4, P2],
      ],
      [
        [P1, P4],
        [P3, P2],
      ],
    ]);
    const t = tiebreakers(stateOf(log));
    expect(t[P2].matchWinPct).toBe(PERCENTAGE_FLOOR);
    expect(t[P2].gameWinPct).toBe(PERCENTAGE_FLOOR);
    expect(t[P1].matchWinPct).toBe(1);
    // P1: 6 games won, 2 lost → 18 / 24.
    expect(t[P1].gameWinPct).toBe(0.75);
  });

  it('gives a 1-2 player MW% 3/9, not the floor', () => {
    const log = swissHistory(PLAYERS.slice(0, 4), [
      [
        [P1, P2],
        [P3, P4],
      ],
      [
        [P1, P3],
        [P2, P4],
      ],
      [
        [P1, P4],
        [P3, P2],
      ],
    ]);
    // P2: L, W, L.
    expect(tiebreakers(stateOf(log))[P2].matchWinPct).toBeCloseTo(1 / 3, 12);
  });

  it('gives 33% to a player with 0 rounds or 0 games', () => {
    const log = swissHistory(PLAYERS.slice(0, 4), [
      [
        [P1, P2, ID],
        [P3, P4],
      ],
    ]).add('PlayerRegistered', { playerId: uuid(150), playerName: 'Late' });
    const t = tiebreakers(stateOf(log));
    // Only an intentional draw: MW% 1/3, no games.
    expect(t[P1].matchWinPct).toBeCloseTo(1 / 3, 12);
    expect(t[P1].gameWinPct).toBe(PERCENTAGE_FLOOR);
    // No rounds at all.
    expect(t[uuid(150)]).toMatchObject({
      matchWinPct: PERCENTAGE_FLOOR,
      gameWinPct: PERCENTAGE_FLOOR,
      opponentMatchWinPct: PERCENTAGE_FLOOR,
      opponentGameWinPct: PERCENTAGE_FLOOR,
    });
  });

  it('averages the opponents floored values, one entry per match', () => {
    // T plays X (round 1) and Y (round 2), then drops. X ends 1-4 (MW% 0.2), Y 5-0 (MW% 1.0).
    const [T, X, Y, Z] = PLAYERS;
    const log = logBuilder({ ...CREATED_PAYLOAD, swissRounds: 5 });
    for (const [i, playerId] of [T, X, Y, Z].entries()) {
      log.add('PlayerRegistered', { playerId, playerName: `Player ${i + 1}` });
    }
    const round = (n: number, pairings: [string, string | null, MatchResult?][]) => {
      const ps = pairings.map(([a, b], i) => pairing(n * 10 + i, i + 1, a, b));
      log.add('RoundPaired', { round: n, stage: 'swiss', pairings: ps });
      for (const [i, [, b, result]] of pairings.entries()) {
        if (b !== null) {
          log.add('ResultReported', { matchId: ps[i].matchId, result: result ?? WIN_A });
        }
      }
      log.add('RoundClosed', { round: n });
    };
    round(1, [
      [X, T],
      [Y, Z],
    ]);
    round(2, [
      [Y, T],
      [Z, X],
    ]);
    log.add('PlayerDropped', { playerId: T });
    for (const n of [3, 4, 5]) {
      round(n, [
        [Y, X],
        [Z, null],
      ]);
    }
    const t = tiebreakers(stateOf(log));
    expect(t[X].matchWinPct).toBe(PERCENTAGE_FLOOR); // 3 / 15 = 0.2, floored
    expect(t[Y].matchWinPct).toBe(1);
    expect(t[T].opponentMatchWinPct).toBeCloseTo(0.665, 12);
    // X: 2-1 win, then four 1-2 losses → 6 won, 9 lost = 18 / 45 = 0.4. Y: 10 won, 5 lost = 2/3.
    expect(t[T].opponentGameWinPct).toBeCloseTo((0.4 + 2 / 3) / 2, 12);
    // Y faced Z, T, then X three times: one entry per match. Z is 4-1 (3 byes), T is 0-2.
    expect(t[Z].matchWinPct).toBeCloseTo(12 / 15, 12);
    expect(t[Y].opponentMatchWinPct).toBeCloseTo((12 / 15 + 4 * PERCENTAGE_FLOOR) / 5, 12);
  });

  it('gives a bye-only player OMW% and OGW% of 33% and GW% of 100%', () => {
    const log = swissHistory(PLAYERS.slice(0, 3), [
      [
        [P1, P2],
        [P3, null],
      ],
    ]);
    expect(tiebreakers(stateOf(log))[P3]).toMatchObject({
      matchPoints: 3,
      wins: 1,
      matchWinPct: 1,
      gameWinPct: 1,
      opponentMatchWinPct: PERCENTAGE_FLOOR,
      opponentGameWinPct: PERCENTAGE_FLOOR,
    });
  });

  it("does not count a late entry's missed rounds", () => {
    const late = uuid(150);
    const log = swissHistory(PLAYERS.slice(0, 3), [
      [
        [P1, P2],
        [P3, null],
      ],
    ]).add('PlayerRegistered', { playerId: late, playerName: 'Late' });
    addClosedRound(log, 2, 'swiss', [pairing(3, 1, late, P1), pairing(4, 2, P2, P3)]);
    addClosedRound(log, 3, 'swiss', [pairing(5, 1, late, P2), pairing(6, 2, P1, P3)]);
    expect(tiebreakers(stateOf(log))[late]).toMatchObject({
      matchPoints: 6,
      wins: 2,
      losses: 0,
      matchWinPct: 1,
    });
  });

  it('counts a dropped opponent with the rounds they played', () => {
    // P2 loses round 1 to P1, wins round 2, then drops: MW% 3 / 6 = 0.5.
    const log = swissHistory(PLAYERS.slice(0, 4), [
      [
        [P1, P2],
        [P3, P4],
      ],
      [
        [P1, P3],
        [P2, P4],
      ],
    ]).add('PlayerDropped', { playerId: P2 });
    addClosedRound(log, 3, 'swiss', [pairing(5, 1, P1, P4), pairing(6, 2, P3, null)]);
    const t = tiebreakers(stateOf(log));
    expect(t[P2].matchWinPct).toBe(0.5);
    // P1 faced P2 (0.5), P3 (round 1 win, round 2 loss, round 3 bye: 2/3) and P4 (0-3 → 0.33).
    expect(t[P1].opponentMatchWinPct).toBeCloseTo((0.5 + 2 / 3 + PERCENTAGE_FLOOR) / 3, 12);
  });

  it('ignores the open round and rounds above throughRound', () => {
    const log = swissHistory(PLAYERS.slice(0, 4), [
      [
        [P1, P2],
        [P3, P4],
      ],
      [
        [P1, P3],
        [P2, P4, WIN_B],
      ],
    ])
      .add('RoundPaired', {
        round: 3,
        stage: 'swiss',
        pairings: [pairing(5, 1, P1, P4), pairing(6, 2, P2, P3)],
      })
      .add('ResultReported', { matchId: matchId(5), result: WIN_B });
    const state = stateOf(log);

    expect(tiebreakers(state)[P1]).toMatchObject({ matchPoints: 6, wins: 2, losses: 0 });
    expect(tiebreakers(state, 3)[P1]).toMatchObject({ matchPoints: 6, wins: 2, losses: 0 });
    expect(tiebreakers(state, 1)[P1]).toMatchObject({
      matchPoints: 3,
      wins: 1,
      opponentMatchWinPct: PERCENTAGE_FLOOR,
    });
    // After round 1 P4 (opponent of P3) is 0-1, after round 2 P4 is 1-1.
    expect(tiebreakers(state, 1)[P3].opponentMatchWinPct).toBe(PERCENTAGE_FLOOR);
    expect(tiebreakers(state, 2)[P3].opponentMatchWinPct).toBeCloseTo((0.5 + 1) / 2, 12);
    expect(tiebreakers(state, 0)[P1]).toMatchObject({ matchPoints: 0, wins: 0 });
  });
});

const F = PERCENTAGE_FLOOR;

/** A synthetic unranked row for `Player n`: 3 MP and every percentage at 0.5 unless overridden. */
const row = (
  n: number,
  overrides: Partial<Omit<Standing, 'rank'>> = {},
): Omit<Standing, 'rank'> => ({
  playerId: uuid(100 + n),
  playerName: `Player ${n}`,
  dropped: false,
  matchPoints: 3,
  wins: 1,
  losses: 0,
  draws: 0,
  matchWinPct: 0.5,
  opponentMatchWinPct: 0.5,
  gameWinPct: 0.5,
  opponentGameWinPct: 0.5,
  ...overrides,
});

const order = (rows: Standing[]) => rows.map((r) => [r.rank, r.playerName]);

describe('rankStandings', () => {
  it('orders by match points first', () => {
    const ranked = rankStandings([
      row(1, { matchPoints: 3, opponentMatchWinPct: 0.9 }),
      row(2, { matchPoints: 6 }),
    ]);
    expect(order(ranked)).toEqual([
      [1, 'Player 2'],
      [2, 'Player 1'],
    ]);
  });

  it('breaks equal match points with OMW%', () => {
    const ranked = rankStandings([
      row(1, { opponentMatchWinPct: 0.4, gameWinPct: 0.9, opponentGameWinPct: 0.9 }),
      row(2, { opponentMatchWinPct: 0.6 }),
    ]);
    expect(order(ranked)).toEqual([
      [1, 'Player 2'],
      [2, 'Player 1'],
    ]);
  });

  it('breaks equal OMW% with GW%', () => {
    const ranked = rankStandings([
      row(1, { gameWinPct: 0.4, opponentGameWinPct: 0.9 }),
      row(2, { gameWinPct: 0.6 }),
    ]);
    expect(order(ranked)).toEqual([
      [1, 'Player 2'],
      [2, 'Player 1'],
    ]);
  });

  it('breaks equal GW% with OGW%', () => {
    const ranked = rankStandings([row(1, { opponentGameWinPct: 0.4 }), row(2)]);
    expect(order(ranked)).toEqual([
      [1, 'Player 2'],
      [2, 'Player 1'],
    ]);
  });

  it('does not rank by MW% (it only feeds OMW%)', () => {
    const ranked = rankStandings([row(2, { matchWinPct: 0.9 }), row(1)]);
    expect(order(ranked)).toEqual([
      [1, 'Player 1'],
      [1, 'Player 2'],
    ]);
  });

  it('shares the rank on a full tie, skips the next rank, and orders ties by name', () => {
    const ranked = rankStandings([
      row(4, { matchPoints: 0 }),
      row(3),
      row(2, { matchPoints: 6 }),
      row(10),
    ]);
    // "Player 10" sorts before "Player 3" with the en collator.
    expect(order(ranked)).toEqual([
      [1, 'Player 2'],
      [2, 'Player 10'],
      [2, 'Player 3'],
      [4, 'Player 4'],
    ]);
  });

  it('orders players with the same name by player id', () => {
    const ranked = rankStandings([row(2, { playerName: 'Alex' }), row(1, { playerName: 'Alex' })]);
    expect(ranked.map((r) => r.playerId)).toEqual([P1, P2]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1]);
  });

  it('ties two values equal up to floating-point noise', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    const ranked = rankStandings([
      row(2, { opponentMatchWinPct: 0.1 + 0.2 }),
      row(1, { opponentMatchWinPct: 0.3 }),
    ]);
    expect(order(ranked)).toEqual([
      [1, 'Player 1'],
      [1, 'Player 2'],
    ]);
  });
});

describe('standings', () => {
  it('ranks a full tie from the log with a shared rank in name order', () => {
    // P1 and P3 both win 2-1 against 0-1 opponents: equal on every tiebreaker.
    const log = swissHistory(PLAYERS.slice(0, 4), [
      [
        [P3, P4],
        [P1, P2],
      ],
    ]);
    expect(order(standings(stateOf(log)))).toEqual([
      [1, 'Player 1'],
      [1, 'Player 3'],
      [3, 'Player 2'],
      [3, 'Player 4'],
    ]);
  });

  it('ranks dropped players and late entries as normal rows', () => {
    const late = uuid(150);
    const log = swissHistory(PLAYERS.slice(0, 4), [
      [
        [P1, P2],
        [P3, P4],
      ],
    ])
      .add('PlayerDropped', { playerId: P1 })
      .add('PlayerRegistered', { playerId: late, playerName: 'Late' });
    const rows = standings(stateOf(log));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ rank: 1, playerId: P1, dropped: true, matchPoints: 3 });
    // The late entry has the floors; P2 and P4 lost to 1-0 opponents (OMW% 100%).
    expect(rows.find((r) => r.playerId === late)).toMatchObject({
      rank: 5,
      dropped: false,
      matchPoints: 0,
      wins: 0,
      losses: 0,
    });
  });

  it('ranks every player on 0 with the floors before round 1 is closed', () => {
    const rows = standings(stateOf(registeredLog(2)));
    expect(rows.map((r) => [r.rank, r.matchPoints, r.opponentMatchWinPct, r.gameWinPct])).toEqual([
      [1, 0, F, F],
      [1, 0, F, F],
    ]);
  });

  /**
   * Hand-calculated 8-player, 3-round event (results as A-B games):
   *   R1: P1-P2 2-0, P3-P4 2-1, P5-P6 1-1-1, P7-P8 0-2
   *   R2: P1-P3 2-1, P8-P5 1-2, P6-P2 2-0, P4-P7 intentional draw
   *   R3: P1-P5 0-2, P6-P3 2-1, P8-P4 2-0, P2-P7 1-2
   *
   * Player  MP  W-L-D  games W-L-D  MW%            GW%
   * P1       6  2-1-0  4-3-0        6/9            12/21 = 4/7
   * P2       0  0-3-0  1-6-0        0   → F        3/21  → F
   * P3       3  1-2-0  4-5-0        3/9            12/27 = 4/9
   * P4       1  0-2-1  1-4-0        1/9 → F        3/15  → F
   * P5       7  2-0-1  5-2-1        7/9            16/24 = 2/3
   * P6       7  2-0-1  5-2-1        7/9            16/24 = 2/3
   * P7       4  1-1-1  2-3-0        4/9            6/15  = 0.4
   * P8       6  2-1-0  5-2-0        6/9            15/21 = 5/7
   *
   * F = 0.33. OMW% and OGW% average the three opponents' values above. P5 and P6 tie on MP and
   * GW%; OMW% puts P5 first. P8 and P1 tie on MP; OMW% puts P8 first.
   */
  it('matches a hand-calculated 8-player, 3-round event', () => {
    const log = swissHistory(PLAYERS, [
      [
        [P1, P2, played(2, 0)],
        [P3, P4, played(2, 1)],
        [P5, P6, played(1, 1, 1)],
        [P7, P8, played(0, 2)],
      ],
      [
        [P1, P3, played(2, 1)],
        [P8, P5, played(1, 2)],
        [P6, P2, played(2, 0)],
        [P4, P7, ID],
      ],
      [
        [P1, P5, played(0, 2)],
        [P6, P3, played(2, 1)],
        [P8, P4, played(2, 0)],
        [P2, P7, played(1, 2)],
      ],
    ]);
    // [rank, player, MP, W, L, D, OMW%, GW%, OGW%]
    const expected = [
      [1, P5, 7, 2, 0, 1, (7 / 9 + 6 / 9 + 6 / 9) / 3, 2 / 3, (2 / 3 + 5 / 7 + 4 / 7) / 3],
      [2, P6, 7, 2, 0, 1, (7 / 9 + F + 3 / 9) / 3, 2 / 3, (2 / 3 + F + 4 / 9) / 3],
      [3, P8, 6, 2, 1, 0, (4 / 9 + 7 / 9 + F) / 3, 5 / 7, (0.4 + 2 / 3 + F) / 3],
      [4, P1, 6, 2, 1, 0, (F + 3 / 9 + 7 / 9) / 3, 4 / 7, (F + 4 / 9 + 2 / 3) / 3],
      [5, P7, 4, 1, 1, 1, (6 / 9 + F + F) / 3, 0.4, (5 / 7 + F + F) / 3],
      [6, P3, 3, 1, 2, 0, (F + 6 / 9 + 7 / 9) / 3, 4 / 9, (F + 4 / 7 + 2 / 3) / 3],
      [7, P4, 1, 0, 2, 1, (3 / 9 + 4 / 9 + 6 / 9) / 3, F, (4 / 9 + 0.4 + 5 / 7) / 3],
      [8, P2, 0, 0, 3, 0, (6 / 9 + 7 / 9 + 4 / 9) / 3, F, (4 / 7 + 2 / 3 + 0.4) / 3],
    ] as const;

    const rows = standings(stateOf(log));
    expect(rows).toHaveLength(8);
    for (const [i, [rank, id, mp, w, l, d, omw, gw, ogw]] of expected.entries()) {
      const r = rows[i];
      expect([r.rank, r.playerId, r.matchPoints, r.wins, r.losses, r.draws]).toEqual([
        rank,
        id,
        mp,
        w,
        l,
        d,
      ]);
      expect(r.opponentMatchWinPct).toBeCloseTo(omw, 12);
      expect(r.gameWinPct).toBeCloseTo(gw, 12);
      expect(r.opponentGameWinPct).toBeCloseTo(ogw, 12);
    }
    // The same values rounded by hand to 2 decimals, as the table shows them.
    const pct = (value: number) => (value * 100).toFixed(2);
    expect(rows.map((r) => [pct(r.opponentMatchWinPct), pct(r.gameWinPct)])).toEqual([
      ['70.37', '66.67'],
      ['48.04', '66.67'],
      ['51.74', '71.43'],
      ['48.04', '57.14'],
      ['44.22', '40.00'],
      ['59.15', '44.44'],
      ['48.15', '33.00'],
      ['62.96', '33.00'],
    ]);
  });
});
