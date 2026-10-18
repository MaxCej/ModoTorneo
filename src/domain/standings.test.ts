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
import { PERCENTAGE_FLOOR, lastClosedSwissRound, tiebreakers } from './standings';

const [P1, P2, P3, P4] = PLAYERS;

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
