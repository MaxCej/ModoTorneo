import { describe, expect, it } from 'vitest';
import { executeAll } from './commands';
import {
  PLAYERS,
  TOURNAMENT_ID,
  WIN_A,
  swissHistory,
  uuid,
  type LogBuilder,
} from './fixtures/builders';
import { reduce } from './reduce';
import type { TournamentDocument } from './schemas/document';
import type { RoundPairedPayload } from './schemas/events';
import type { MatchResult } from './schemas/matchResult';
import {
  bracketOrder,
  defaultTopCutSize,
  pairTopCutRound,
  seedPreview,
  startTopCutCommands,
  topCutBracket,
  topCutPlacings,
  topCutRoundName,
  topCutSeeds,
} from './topCut';
import fixture from './fixtures/top4-8players.json';

const [P1, P2, P3, P4, P5, P6, P7, P8] = PLAYERS;

const WIN_B: MatchResult = { winsA: 1, winsB: 2, draws: 0, kind: 'played' };
const ID: MatchResult = { winsA: 0, winsB: 0, draws: 0, kind: 'intentionalDraw' };

const stateOf = (log: LogBuilder) => reduce(log.events, TOURNAMENT_ID);

/** One round, all 2-1 wins for A: P1, P3, P5, P7 share rank 1, the others share rank 5. */
function fourWinners() {
  return swissHistory(PLAYERS, [
    [
      [P1, P2],
      [P3, P4],
      [P5, P6],
      [P7, P8],
    ],
  ]);
}

/** One round, P7 and P8 draw: P1, P3, P5 share rank 1 and P7, P8 share rank 4 (the Top 4 cut line). */
function cutLineTie() {
  return swissHistory(PLAYERS, [
    [
      [P1, P2],
      [P3, P4],
      [P5, P6],
      [P7, P8, ID],
    ],
  ]);
}

describe('defaultTopCutSize', () => {
  it.each([
    [7, null],
    [8, 4],
    [16, 4],
    [17, 8],
    [32, 8],
    [33, 16],
    [64, 16],
    [65, 32],
  ])('%i active players → %s', (active, size) => {
    expect(defaultTopCutSize(active)).toBe(size);
  });
});

describe('bracketOrder', () => {
  it('places seeds so 1 and 2 meet only in the final', () => {
    expect(bracketOrder(4)).toEqual([1, 4, 2, 3]);
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it.each([4, 8, 16, 32] as const)('pairs seeds summing to %i + 1 in the first round', (size) => {
    const order = bracketOrder(size);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: size }, (_, i) => i + 1));
    for (let slot = 0; slot < size; slot += 2) {
      expect(order[slot] + order[slot + 1]).toBe(size + 1);
    }
  });
});

describe('topCutRoundName', () => {
  it.each([
    [1, 'final'],
    [2, 'semifinals'],
    [4, 'quarterfinals'],
    [8, 'roundOf16'],
    [16, 'roundOf32'],
  ])('%i matches → %s', (matches, name) => {
    expect(topCutRoundName(matches)).toBe(name);
  });

  it('throws for a match count no top cut round has', () => {
    expect(() => topCutRoundName(3)).toThrow();
  });
});

describe('seedPreview', () => {
  it('lists the top players by standings with the players sharing their rank', () => {
    const { seeds, tieAtCutLine } = seedPreview(stateOf(fourWinners()), 4);

    expect(seeds.map((s) => s.playerId)).toEqual([P1, P3, P5, P7]);
    expect(seeds[0].tiedWith).toEqual([P3, P5, P7]);
    expect(tieAtCutLine).toEqual([]);
  });

  it('lists a tie at the cut line', () => {
    const { seeds, tieAtCutLine } = seedPreview(stateOf(cutLineTie()), 4);

    expect(seeds.map((s) => s.playerId)).toEqual([P1, P3, P5, P7]);
    expect(seeds[3].tiedWith).toEqual([P8]);
    expect(tieAtCutLine).toEqual([P7, P8]);
  });

  it('never seeds a dropped player', () => {
    const log = fourWinners().add('PlayerDropped', { playerId: P3 });
    const { seeds } = seedPreview(stateOf(log), 4);

    expect(seeds.map((s) => s.playerId)).not.toContain(P3);
    expect(seeds.map((s) => s.playerId).slice(0, 3)).toEqual([P1, P5, P7]);
    expect(seeds[0].tiedWith).toEqual([P5, P7]);
  });
});

describe('topCutSeeds', () => {
  it('follows the standings', () => {
    const log = swissHistory(PLAYERS, [
      [
        [P1, P2],
        [P3, P4],
        [P5, P6],
        [P7, P8],
      ],
      [
        [P1, P3],
        [P5, P7],
        [P2, P4],
        [P6, P8],
      ],
    ]);
    // P1 is the only player on 6 MP.
    expect(topCutSeeds(stateOf(log), 4, () => 0.999)[0]).toBe(P1);
  });

  it('orders tied players with the injected random', () => {
    const state = stateOf(fourWinners());

    // j = i every step: no swap, so the standings (name) order stays.
    expect(topCutSeeds(state, 4, () => 0.999)).toEqual([P1, P3, P5, P7]);
    // j = 0 every step: [P1, P3, P5, P7] → [P7, P3, P5, P1] → [P5, P3, P7, P1] → [P3, P5, P7, P1].
    expect(topCutSeeds(state, 4, () => 0)).toEqual([P3, P5, P7, P1]);
  });

  it('draws across the cut line', () => {
    const state = stateOf(cutLineTie());

    // Rank 1 group [P1, P3, P5] → [P3, P5, P1]; rank 4 group [P7, P8] → [P8, P7].
    expect(topCutSeeds(state, 4, () => 0)).toEqual([P3, P5, P1, P8]);
    expect(topCutSeeds(state, 4, () => 0.999)).toEqual([P1, P3, P5, P7]);
  });

  it('never seeds a dropped player', () => {
    const log = fourWinners().add('PlayerDropped', { playerId: P1 });
    const seeds = topCutSeeds(stateOf(log), 4, () => 0.999);

    expect(seeds).not.toContain(P1);
    expect(seeds).toEqual([P3, P5, P7, P2]);
  });
});

/** Ids for every test deps, so match ids never repeat within a log. */
let nextId = 0;

/** Deterministic deps: ids `uuid(5000 + n)`, fixed clock, `random` keeps tied players in order. */
function testDeps(random = () => 0.999) {
  return {
    now: () => '2026-10-11T20:00:00.000Z',
    newId: () => uuid(5000 + ++nextId),
    random,
  };
}

const docOf = (log: LogBuilder): TournamentDocument => ({
  schemaVersion: 1,
  id: TOURNAMENT_ID,
  events: log.events,
});

/** Pairs `payload`, reports `results` in table order (default WIN_A) and closes the round. */
function playRound(log: LogBuilder, payload: RoundPairedPayload, results: MatchResult[] = []) {
  log.add('RoundPaired', payload);
  for (const [i, p] of payload.pairings.entries()) {
    log.add('ResultReported', { matchId: p.matchId, result: results[i] ?? WIN_A });
  }
  return log.add('RoundClosed', { round: payload.round });
}

function paired(log: LogBuilder, deps = testDeps()): RoundPairedPayload {
  const result = pairTopCutRound(stateOf(log), deps);
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const players = (payload: RoundPairedPayload) =>
  payload.pairings.map((p) => [p.table, p.playerA, p.playerB]);

// fourWinners seeds, with ties kept in order: P1, P3, P5, P7, P2, P4, P6, P8 (seeds 1–8).
describe('pairTopCutRound', () => {
  const top8 = () => fourWinners().add('TopCutStarted', { size: 8 });

  it('pairs a Top 8 first round 1v8, 4v5, 2v7, 3v6 with the better seed as playerA', () => {
    const first = paired(top8());

    expect(first.round).toBe(2);
    expect(first.stage).toBe('topCut');
    expect(players(first)).toEqual([
      [1, P1, P8],
      [2, P7, P2],
      [3, P3, P6],
      [4, P5, P4],
    ]);
  });

  it('pairs the winners of tables 1–2 and 3–4, better seed as playerA', () => {
    // P8 (seed 8) beats P1 and P2 (seed 5) beats P7: table 1 of the semifinals is P2 v P8.
    const log = top8();
    playRound(log, paired(log), [WIN_B, WIN_B, WIN_A, WIN_A]);
    const semis = paired(log);

    expect(semis.round).toBe(3);
    expect(players(semis)).toEqual([
      [1, P2, P8],
      [2, P3, P5],
    ]);
  });

  it('pairs the final from the semifinal winners and nothing after it', () => {
    const log = top8();
    playRound(log, paired(log));
    playRound(log, paired(log), [WIN_A, WIN_B]);
    const final = paired(log);

    // Semifinal winners: P1 (seed 1) and P5 (seed 3).
    expect(players(final)).toEqual([[1, P1, P5]]);
    playRound(log, final);
    expect(pairTopCutRound(stateOf(log), testDeps())).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAIRINGS' },
    });
  });

  it('every payload passes validate', () => {
    const log = top8();
    for (let round = 0; round < 3; round++) {
      const payload = paired(log);
      const result = executeAll(docOf(log), [{ type: 'RoundPaired', payload }], testDeps());
      expect(result.ok).toBe(true);
      playRound(log, payload);
    }
  });

  it('refuses while a round is open', () => {
    const log = top8();
    log.add('RoundPaired', paired(log));
    expect(pairTopCutRound(stateOf(log), testDeps())).toMatchObject({
      ok: false,
      error: { code: 'ROUND_STILL_OPEN' },
    });
  });

  it('refuses outside the top cut', () => {
    expect(pairTopCutRound(stateOf(fourWinners()), testDeps())).toMatchObject({
      ok: false,
      error: { code: 'WRONG_STATUS' },
    });
  });

  it('pairs the first round again after a rollback to TopCutStarted', () => {
    const log = top8();
    const startedSeq = log.events.length;
    playRound(log, paired(log));
    log.add('RolledBack', { toSeq: startedSeq });

    expect(stateOf(log).rounds.filter((r) => r.stage === 'topCut')).toEqual([]);
    expect(players(paired(log))).toEqual([
      [1, P1, P8],
      [2, P7, P2],
      [3, P3, P6],
      [4, P5, P4],
    ]);
  });
});

describe('startTopCutCommands', () => {
  it('returns TopCutStarted and the first top cut RoundPaired, both valid', () => {
    const doc = docOf(fourWinners());
    const result = startTopCutCommands(doc, 4, 5, testDeps());
    if (!result.ok) {
      throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
    }
    const [start, pairing] = result.value;

    expect(start).toEqual({ type: 'TopCutStarted', payload: { size: 4, bestOf: 5 } });
    expect(pairing).toMatchObject({ type: 'RoundPaired', payload: { round: 2, stage: 'topCut' } });
    const applied = executeAll(doc, result.value, testDeps());
    expect(applied).toMatchObject({
      ok: true,
      value: { state: { status: 'topCut', topCut: 4, topCutBestOf: 5 } },
    });
  });

  it('returns the validation error for a size above the active players', () => {
    expect(startTopCutCommands(docOf(fourWinners()), 16, 3, testDeps())).toMatchObject({
      ok: false,
      error: { code: 'WRONG_STATUS' },
    });
  });

  it('leaves the document unchanged', () => {
    const doc = docOf(fourWinners());
    const before = JSON.stringify(doc);
    startTopCutCommands(doc, 8, 3, testDeps());
    expect(JSON.stringify(doc)).toBe(before);
  });
});

const placeOf = (log: LogBuilder) =>
  topCutPlacings(stateOf(log)).map((p) => [p.playerId, p.from, p.to]);

describe('topCutBracket', () => {
  it('is null before TopCutStarted', () => {
    expect(topCutBracket(stateOf(fourWinners()))).toBeNull();
  });

  it('has no rounds before the first top cut round', () => {
    const log = fourWinners().add('TopCutStarted', { size: 4, bestOf: 5 });
    expect(topCutBracket(stateOf(log))).toEqual({ size: 4, bestOf: 5, rounds: [] });
  });

  it('lists each top cut round with seeds, results and winners', () => {
    const log = fourWinners().add('TopCutStarted', { size: 4 });
    const semis = paired(log);
    playRound(log, semis, [WIN_A, WIN_B]);
    log.add('RoundPaired', paired(log));
    const bracket = topCutBracket(stateOf(log));

    // Seeds P1, P3, P5, P7: semifinals P1 (1) v P7 (4) and P3 (2) v P5 (3); P5 wins table 2.
    expect(bracket?.rounds.map((r) => [r.round, r.name])).toEqual([
      [2, 'semifinals'],
      [3, 'final'],
    ]);
    expect(bracket?.rounds[0].matches).toEqual([
      {
        table: 1,
        playerA: { playerId: P1, seed: 1 },
        playerB: { playerId: P7, seed: 4 },
        result: WIN_A,
        winner: P1,
      },
      {
        table: 2,
        playerA: { playerId: P3, seed: 2 },
        playerB: { playerId: P5, seed: 3 },
        result: WIN_B,
        winner: P5,
      },
    ]);
    expect(bracket?.rounds[1].matches).toEqual([
      {
        table: 1,
        playerA: { playerId: P1, seed: 1 },
        playerB: { playerId: P5, seed: 3 },
        result: null,
        winner: null,
      },
    ]);
  });
});

describe('topCutPlacings', () => {
  it('is empty before the first top cut round', () => {
    expect(placeOf(fourWinners().add('TopCutStarted', { size: 4 }))).toEqual([]);
  });

  it('places a finished Top 8: 1st, 2nd, two 3rd–4th and four 5th–8th', () => {
    const log = fourWinners().add('TopCutStarted', { size: 8 });
    playRound(log, paired(log)); // P1, P7, P3, P5 win
    playRound(log, paired(log)); // P1, P3 win
    playRound(log, paired(log), [WIN_B]); // P3 wins the final
    log.add('TournamentFinished', {});

    expect(placeOf(log)).toEqual([
      [P3, 1, 1],
      [P1, 2, 2],
      [P5, 3, 4],
      [P7, 3, 4],
      [P2, 5, 8],
      [P4, 5, 8],
      [P6, 5, 8],
      [P8, 5, 8],
    ]);
  });

  it('gives the finalists 1st–2nd when the tournament finishes after the semifinals', () => {
    const log = fourWinners().add('TopCutStarted', { size: 4 });
    playRound(log, paired(log));
    log.add('TournamentFinished', {});

    expect(placeOf(log)).toEqual([
      [P1, 1, 2],
      [P3, 1, 2],
      [P5, 3, 4],
      [P7, 3, 4],
    ]);
  });

  it('shares 1st to N among players still in during a round', () => {
    const log = fourWinners().add('TopCutStarted', { size: 4 });
    const semis = paired(log);
    log.add('RoundPaired', semis);
    log.add('ResultReported', { matchId: semis.pairings[0].matchId, result: WIN_A });

    // P7 lost; P1 won; P3 and P5 have not played yet.
    expect(placeOf(log)).toEqual([
      [P1, 1, 3],
      [P3, 1, 3],
      [P5, 1, 3],
      [P7, 3, 4],
    ]);
  });

  it('places Diego 1st and Alice 2nd in the SPEC 02 fixture', () => {
    const doc = fixture as TournamentDocument;
    const placings = topCutPlacings(reduce(doc.events, doc.id));
    expect(placings.slice(0, 2).map((p) => [p.playerId, p.from, p.to])).toEqual([
      [P4, 1, 1],
      [P1, 2, 2],
    ]);
    expect(placings.slice(2).map((p) => [p.from, p.to])).toEqual([
      [3, 4],
      [3, 4],
    ]);
  });
});
