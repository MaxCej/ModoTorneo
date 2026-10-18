import { describe, expect, it } from 'vitest';
import { execute } from './commands';
import {
  CREATED_PAYLOAD,
  TOURNAMENT_ID,
  addClosedRound,
  logBuilder,
  pairing,
  playerIds,
  registeredLog,
  swissHistory,
  uuid,
  type LogBuilder,
} from './fixtures/builders';
import { pairingWarnings, pairSwissRound, type PairingDeps } from './pairing';
import { playerRecords } from './points';
import { reduce } from './reduce';
import type { RoundPairedPayload } from './schemas/events';
import type { MatchResult } from './schemas/matchResult';

/** Small seeded PRNG (mulberry32), so every test run sees the same sequence. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Match ids never repeat within a test file, so generated rounds can be chained. */
let idCount = 0;

function deps(seed: number): PairingDeps {
  return { random: seeded(seed), newId: () => uuid(50_000 + ++idCount) };
}

const stateOf = (log: LogBuilder) => reduce(log.events, TOURNAMENT_ID);

function pair(log: LogBuilder, seed = 1): RoundPairedPayload {
  const result = pairSwissRound(stateOf(log), deps(seed));
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Appends the payload with `execute`, so `validate` checks it. */
function assertValid(log: LogBuilder, payload: RoundPairedPayload) {
  const doc = { schemaVersion: 1 as const, id: TOURNAMENT_ID, events: log.events };
  const result = execute(doc, { type: 'RoundPaired', payload });
  expect(result.ok ? null : result.error).toBeNull();
}

const LOSS_A: MatchResult = { winsA: 0, winsB: 2, draws: 0, kind: 'played' };

describe('pairSwissRound preconditions', () => {
  it('returns WRONG_STATUS once the tournament is finished', () => {
    const log = addClosedRound(registeredLog(2), 1, 'swiss', [
      pairing(1, 1, playerIds(2)[0], playerIds(2)[1]),
    ]).add('TournamentFinished', {});
    expect(pairSwissRound(stateOf(log), deps(1))).toMatchObject({
      ok: false,
      error: { code: 'WRONG_STATUS' },
    });
  });

  it('returns WRONG_STATUS during the top cut', () => {
    const [a, b, c, d] = playerIds(4);
    const log = swissHistory(playerIds(4), [
      [
        [a, b],
        [c, d],
      ],
    ]).add('TopCutStarted', { size: 4 });
    expect(pairSwissRound(stateOf(log), deps(1))).toMatchObject({
      ok: false,
      error: { code: 'WRONG_STATUS' },
    });
  });

  it('returns ROUND_STILL_OPEN while a round is open', () => {
    const [a, b] = playerIds(2);
    const log = registeredLog(2).add('RoundPaired', {
      round: 1,
      stage: 'swiss',
      pairings: [pairing(1, 1, a, b)],
    });
    expect(pairSwissRound(stateOf(log), deps(1))).toMatchObject({
      ok: false,
      error: { code: 'ROUND_STILL_OPEN' },
    });
  });

  it('returns TOO_MANY_ROUNDS after the last swiss round', () => {
    const [a, b] = playerIds(2);
    const log = swissHistory(playerIds(2), [[[a, b]]], { ...CREATED_PAYLOAD, swissRounds: 1 });
    expect(pairSwissRound(stateOf(log), deps(1))).toMatchObject({
      ok: false,
      error: { code: 'TOO_MANY_ROUNDS' },
    });
  });

  it('returns TOO_MANY_ROUNDS against the resolved auto value', () => {
    const [a, b] = playerIds(2);
    // 2 players: auto resolves to 1 round when round 1 is paired.
    const log = swissHistory(playerIds(2), [[[a, b]]], { ...CREATED_PAYLOAD, swissRounds: null });
    expect(pairSwissRound(stateOf(log), deps(1))).toMatchObject({
      ok: false,
      error: { code: 'TOO_MANY_ROUNDS' },
    });
  });

  it.each([
    ['no player', 0, 3],
    ['one player', 1, 3],
    ['one player with auto rounds', 1, null],
  ])('returns INVALID_PAIRINGS with %s', (_, count, swissRounds) => {
    const log = registeredLog(count, { ...CREATED_PAYLOAD, swissRounds });
    expect(pairSwissRound(stateOf(log), deps(1))).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAIRINGS' },
    });
  });

  it('returns INVALID_PAIRINGS when only one player is still active', () => {
    const [a, b] = playerIds(2);
    const log = swissHistory(playerIds(2), [[[a, b]]]).add('PlayerDropped', { playerId: b });
    expect(pairSwissRound(stateOf(log), deps(1))).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAIRINGS' },
    });
  });
});

describe('pairSwissRound round 1', () => {
  const field = (count: number) => {
    const log = logBuilder({ ...CREATED_PAYLOAD, swissRounds: null });
    for (const [i, playerId] of playerIds(count).entries()) {
      log.add('PlayerRegistered', { playerId, playerName: `Player ${i + 1}` });
    }
    return log;
  };
  const seats = (payload: RoundPairedPayload) =>
    payload.pairings.flatMap((p) => [p.playerA, p.playerB]);

  it('pairs every active player once and passes validate', () => {
    const log = field(8);
    const payload = pair(log);
    expect(payload).toMatchObject({ round: 1, stage: 'swiss' });
    expect([...seats(payload)].sort()).toEqual([...playerIds(8)].sort());
    assertValid(log, payload);
  });

  it('returns the same pairings for the same random sequence', () => {
    const log = field(10);
    // Match ids come from deps.newId; compare tables and seats only.
    const seatsOf = (payload: RoundPairedPayload) =>
      payload.pairings.map(({ table, playerA, playerB }) => ({ table, playerA, playerB }));
    expect(seatsOf(pair(log, 42))).toEqual(seatsOf(pair(log, 42)));
  });

  it('depends on the random sequence', () => {
    const log = field(10);
    const orders = new Set([1, 2, 3, 4, 5].map((seed) => JSON.stringify(seats(pair(log, seed)))));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('numbers tables 1..k and puts the bye on the last table', () => {
    const log = field(7);
    const payload = pair(log);
    expect(payload.pairings.map((p) => p.table)).toEqual([1, 2, 3, 4]);
    expect(payload.pairings.map((p) => p.playerB === null)).toEqual([false, false, false, true]);
    expect(new Set(payload.pairings.map((p) => p.matchId)).size).toBe(4);
    assertValid(log, payload);
  });

  it('skips dropped players', () => {
    const ids = playerIds(5);
    const log = field(5).add('PlayerDropped', { playerId: ids[4] });
    const payload = pair(log);
    expect(seats(payload)).not.toContain(ids[4]);
    expect(payload.pairings.every((p) => p.playerB !== null)).toBe(true);
    assertValid(log, payload);
  });
});

describe('pairSwissRound bye', () => {
  it('goes to a player with the lowest points who had no bye, for 9 players in round 2', () => {
    const ids = playerIds(9);
    // Round 1: ids[0..7] in 4 matches (A wins), ids[8] on the bye with 3 points.
    const log = swissHistory(ids, [
      [
        [ids[0], ids[1]],
        [ids[2], ids[3]],
        [ids[4], ids[5]],
        [ids[6], ids[7]],
        [ids[8], null],
      ],
    ]);
    const losers = [ids[1], ids[3], ids[5], ids[7]];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const payload = pair(log, seed);
      const bye = payload.pairings.find((p) => p.playerB === null);
      expect(losers).toContain(bye?.playerA);
      expect(bye?.table).toBe(5);
      assertValid(log, payload);
    }
  });

  it('goes to the lowest points overall when every active player had a bye', () => {
    const [a, b, c] = playerIds(3);
    // Each player had one bye; a wins twice, b once, c never.
    const log = swissHistory(playerIds(3), [
      [
        [a, b],
        [c, null],
      ],
      [
        [a, c],
        [b, null],
      ],
      [
        [b, c, LOSS_A],
        [a, null],
      ],
    ]);
    const records = playerRecords(stateOf(log));
    expect([records[a].byes, records[b].byes, records[c].byes]).toEqual([1, 1, 1]);
    expect(records[b].matchPoints).toBe(3); // b: bye only, lost to a, lost to c

    const bye = pair(log).pairings.find((p) => p.playerB === null);
    expect(bye?.playerA).toBe(b);
  });

  it('breaks bye ties at random', () => {
    const ids = playerIds(5);
    const log = logBuilder({ ...CREATED_PAYLOAD, swissRounds: null });
    for (const [i, playerId] of ids.entries()) {
      log.add('PlayerRegistered', { playerId, playerName: `Player ${i + 1}` });
    }
    const byes = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map(
        (seed) => pair(log, seed).pairings.find((p) => p.playerB === null)?.playerA,
      ),
    );
    expect(byes.size).toBeGreaterThan(1);
  });
});

describe('pairSwissRound ordering', () => {
  it('pairs higher points first, on the lowest tables', () => {
    const ids = playerIds(8);
    const log = swissHistory(ids, [
      [
        [ids[0], ids[1]],
        [ids[2], ids[3]],
        [ids[4], ids[5]],
        [ids[6], ids[7]],
      ],
    ]);
    const winners = [ids[0], ids[2], ids[4], ids[6]];
    const payload = pair(log);
    const top = payload.pairings.filter((p) => p.table <= 2);
    expect(top.flatMap((p) => [p.playerA, p.playerB]).every((id) => winners.includes(id!))).toBe(
      true,
    );
    assertValid(log, payload);
  });
});

/** Pairs in `payload` that already met in earlier rounds. */
function rematches(log: LogBuilder, payload: RoundPairedPayload): number {
  const records = playerRecords(stateOf(log));
  return payload.pairings.filter(
    (p) => p.playerB !== null && records[p.playerA].opponents.includes(p.playerB),
  ).length;
}

/** True when some perfect matching of `ids` avoids every pair in `played`. */
function rematchFreeExists(ids: string[], played: Set<string>): boolean {
  if (ids.length === 0) {
    return true;
  }
  const [a, ...rest] = ids;
  return rest.some(
    (b) =>
      !played.has(`${a}|${b}`) &&
      rematchFreeExists(
        rest.filter((x) => x !== b),
        played,
      ),
  );
}

/** Appends a paired round and random results (seeded), then closes it. */
function playRound(log: LogBuilder, payload: RoundPairedPayload, random: () => number) {
  log.add('RoundPaired', payload);
  for (const p of payload.pairings) {
    if (p.playerB !== null) {
      const r = random();
      const result: MatchResult =
        r < 0.45
          ? { winsA: 2, winsB: 0, draws: 0, kind: 'played' }
          : r < 0.9
            ? LOSS_A
            : { winsA: 1, winsB: 1, draws: 1, kind: 'played' };
      log.add('ResultReported', { matchId: p.matchId, result });
    }
  }
  log.add('RoundClosed', { round: payload.round });
}

describe('pairSwissRound rematch avoidance', () => {
  it('backtracks out of the greedy trap and pairs with no rematch', () => {
    // Found by search: for every order of the tied players, greedy pairing hits a dead end.
    const ids = playerIds(6);
    const [p0, p1, p2, p3, p4, p5] = ids;
    const log = swissHistory(ids, [
      [
        [p0, p1],
        [p2, p4, LOSS_A],
        [p3, p5],
      ],
      [
        [p0, p2, LOSS_A],
        [p1, p5, LOSS_A],
        [p3, p4, LOSS_A],
      ],
      [
        [p0, p4, LOSS_A],
        [p1, p3, LOSS_A],
        [p2, p5],
      ],
    ]);
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const payload = pair(log, seed);
      expect(rematches(log, payload)).toBe(0);
      assertValid(log, payload);
    }
  });

  it('pairs within point groups when possible', () => {
    const ids = playerIds(8);
    const log = swissHistory(ids, [
      [
        [ids[0], ids[1]],
        [ids[2], ids[3]],
        [ids[4], ids[5]],
        [ids[6], ids[7]],
      ],
    ]);
    const records = playerRecords(stateOf(log));
    for (const seed of [1, 2, 3]) {
      for (const p of pair(log, seed).pairings) {
        expect(records[p.playerA].matchPoints).toBe(records[p.playerB!].matchPoints);
      }
    }
  });

  it('floats the odd player of a point group down to the next group', () => {
    const ids = playerIds(6);
    // 3 winners (3 points) and 3 losers (0 points).
    const log = swissHistory(ids, [
      [
        [ids[0], ids[1]],
        [ids[2], ids[3]],
        [ids[4], ids[5]],
      ],
    ]);
    const records = playerRecords(stateOf(log));
    for (const seed of [1, 2, 3]) {
      const payload = pair(log, seed);
      const gaps = payload.pairings.map(
        (p) => records[p.playerA].matchPoints - records[p.playerB!].matchPoints,
      );
      expect(gaps.sort()).toEqual([0, 0, 3]);
      expect(gaps.indexOf(3)).not.toBe(0); // the float is not on table 1
      expect(rematches(log, payload)).toBe(0);
    }
  });

  it('pairs 4 players in round 4 with the fewest rematches', () => {
    const [a, b, c, d] = playerIds(4);
    // Rounds 1-3: a full round robin, so every pair already played.
    const log = swissHistory(playerIds(4), [
      [
        [a, b],
        [c, d],
      ],
      [
        [a, c],
        [b, d],
      ],
      [
        [a, d],
        [b, c],
      ],
    ]);
    const payload = pair(log);
    expect(payload.pairings).toHaveLength(2);
    expect(rematches(log, payload)).toBe(2);
    assertValid(log, payload);
  });

  it('avoids a rematch in round 2 of a 4-player event', () => {
    const [a, b, c, d] = playerIds(4);
    // a-b and c-d played in round 1: round 2 must be a-c/b-d or a-d/b-c.
    const log = swissHistory(playerIds(4), [
      [
        [a, b],
        [c, d],
      ],
    ]);
    const payload = pair(log);
    expect(rematches(log, payload)).toBe(0);
  });

  it('never makes a rematch that a brute-force search can avoid', () => {
    for (const seed of [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) {
      const random = seeded(seed);
      const ids = playerIds(8 + (seed % 3) * 2);
      const log = swissHistory(ids, []);
      for (let round = 1; round <= 5; round++) {
        const payload = pair(log, seed * 10 + round);
        const records = playerRecords(stateOf(log));
        const played = new Set(
          Object.values(records).flatMap((r) => r.opponents.map((o) => `${r.playerId}|${o}`)),
        );
        if (rematchFreeExists(ids, played)) {
          expect(rematches(log, payload)).toBe(0);
        }
        assertValid(log, payload);
        playRound(log, payload, random);
      }
    }
  });

  it('pairs 256 players after 5 rounds with no rematch', () => {
    const random = seeded(256);
    const log = swissHistory(playerIds(256), []);
    for (let round = 1; round <= 5; round++) {
      playRound(log, pair(log, round), random);
    }
    const payload = pair(log, 6);
    expect(payload.pairings).toHaveLength(128);
    expect(rematches(log, payload)).toBe(0);
    assertValid(log, payload);
  });
});

describe('pairingWarnings', () => {
  const [a, b, c, d, e] = playerIds(5);

  it('is empty for a clean round, an unknown round and a top cut round', () => {
    const log = swissHistory(playerIds(4), [
      [
        [a, b],
        [c, d],
      ],
      [
        [a, c],
        [b, d],
      ],
    ]);
    expect(pairingWarnings(stateOf(log), 1)).toEqual([]);
    expect(pairingWarnings(stateOf(log), 2)).toEqual([]);
    expect(pairingWarnings(stateOf(log), 9)).toEqual([]);

    log.add('TopCutStarted', { size: 4 });
    addClosedRound(log, 3, 'topCut', [pairing(90, 1, a, b), pairing(91, 2, c, d)]);
    expect(pairingWarnings(stateOf(log), 3)).toEqual([]);
  });

  it('reports exactly 2 rematches for 4 players in round 4', () => {
    const log = swissHistory(playerIds(4), [
      [
        [a, b],
        [c, d],
      ],
      [
        [a, c],
        [b, d],
      ],
      [
        [a, d],
        [b, c],
      ],
    ]);
    const payload = pair(log);
    log.add('RoundPaired', payload);

    const warnings = pairingWarnings(stateOf(log), 4);
    expect(warnings).toHaveLength(2);
    expect(warnings.every((w) => w.kind === 'rematch')).toBe(true);
    expect(warnings.map((w) => w.matchId)).toEqual(payload.pairings.map((p) => p.matchId));
  });

  it('reports a repeated bye', () => {
    const log = swissHistory(playerIds(3), [
      [
        [a, b],
        [c, null],
      ],
    ]).add('RoundPaired', {
      round: 2,
      stage: 'swiss',
      pairings: [pairing(10, 1, a, b), pairing(11, 2, c, null)],
    });

    expect(pairingWarnings(stateOf(log), 2)).toEqual([
      { kind: 'rematch', matchId: pairing(10, 1, a, b).matchId, playerA: a, playerB: b },
      { kind: 'repeatBye', matchId: pairing(11, 2, c, null).matchId, playerId: c },
    ]);
  });

  it('reports the rematch and the repeated bye created by a swap', () => {
    // Round 1: a-b, c-d, e on the bye. Round 2: a-c, b-e, d on the bye.
    const log = swissHistory(playerIds(5), [
      [
        [a, b],
        [c, d],
        [e, null],
      ],
    ]).add('RoundPaired', {
      round: 2,
      stage: 'swiss',
      pairings: [pairing(10, 1, a, c), pairing(11, 2, b, e), pairing(12, 3, d, null)],
    });
    expect(pairingWarnings(stateOf(log), 2)).toEqual([]);

    // Swap d (bye) with e: b-d at table 2, e on the bye again.
    log.add('PlayersSwapped', { round: 2, playerA: d, playerB: e });
    // Swap c with b: a-b and c-d, both round 1 rematches.
    log.add('PlayersSwapped', { round: 2, playerA: c, playerB: b });

    expect(pairingWarnings(stateOf(log), 2)).toEqual([
      { kind: 'rematch', matchId: pairing(10, 1, a, b).matchId, playerA: a, playerB: b },
      { kind: 'rematch', matchId: pairing(11, 2, c, d).matchId, playerA: c, playerB: d },
      { kind: 'repeatBye', matchId: pairing(12, 3, e, null).matchId, playerId: e },
    ]);
  });
});
