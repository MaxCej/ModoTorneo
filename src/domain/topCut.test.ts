import { describe, expect, it } from 'vitest';
import { PLAYERS, TOURNAMENT_ID, swissHistory, type LogBuilder } from './fixtures/builders';
import { reduce } from './reduce';
import type { MatchResult } from './schemas/matchResult';
import {
  bracketOrder,
  defaultTopCutSize,
  seedPreview,
  topCutRoundName,
  topCutSeeds,
} from './topCut';

const [P1, P2, P3, P4, P5, P6, P7, P8] = PLAYERS;

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
