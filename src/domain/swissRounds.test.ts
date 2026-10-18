import { describe, expect, it } from 'vitest';
import {
  SWISS_ROUNDS_TABLE,
  recommendedSwissRounds,
  recommendedSwissRoundsTop8,
} from './swissRounds';

describe('recommendedSwissRounds', () => {
  it.each([
    [0, null],
    [1, null],
    [2, 1],
    [3, 2],
    [4, 2],
    [5, 3],
    [8, 3],
    [9, 4],
    [16, 4],
    [17, 5],
    [32, 5],
    [33, 6],
    [128, 7],
    [226, 8],
    [227, 9],
    [409, 9],
    [410, 10],
    [5000, 10],
  ])('returns %i players → %s rounds', (players, rounds) => {
    expect(recommendedSwissRounds(players)).toBe(rounds);
  });
});

describe('recommendedSwissRoundsTop8', () => {
  it.each([
    [1, null],
    [2, null],
    [8, null],
    [9, 5],
    [16, 5],
    [17, 5],
    [33, 6],
    [409, 9],
    [410, 10],
  ])('returns %i players → %s rounds', (players, rounds) => {
    expect(recommendedSwissRoundsTop8(players)).toBe(rounds);
  });
});

describe('SWISS_ROUNDS_TABLE', () => {
  it('covers every count from 2 up without gaps or overlaps', () => {
    SWISS_ROUNDS_TABLE.forEach((row, i) => {
      const previous = SWISS_ROUNDS_TABLE[i - 1];
      expect(row.min).toBe(previous === undefined ? 2 : (previous.max ?? NaN) + 1);
      expect(row.max === null || row.max >= row.min).toBe(true);
    });
    expect(SWISS_ROUNDS_TABLE.at(-1)?.max).toBeNull();
  });
});
