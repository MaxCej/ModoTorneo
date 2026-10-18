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
import { pairSwissRound, type PairingDeps } from './pairing';
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

function deps(seed: number): PairingDeps {
  let n = 0;
  return { random: seeded(seed), newId: () => uuid(50_000 + ++n) };
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
    expect(pair(log, 42)).toEqual(pair(log, 42));
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
