import { describe, expect, it } from 'vitest';
import { MatchResultSchema, matchOutcome, type MatchResult } from './matchResult';

const played = (winsA: number, winsB: number, draws = 0): MatchResult => ({
  winsA,
  winsB,
  draws,
  kind: 'played',
});

describe('MatchResultSchema', () => {
  it('accepts a played 2-1 result', () => {
    expect(MatchResultSchema.safeParse(played(2, 1)).success).toBe(true);
  });

  it.each(['winsA', 'winsB', 'draws'] as const)('rejects %s outside 0..3 or non-integer', (key) => {
    expect(MatchResultSchema.safeParse({ ...played(1, 1, 1), [key]: 4 }).success).toBe(false);
    expect(MatchResultSchema.safeParse({ ...played(1, 1, 1), [key]: -1 }).success).toBe(false);
    expect(MatchResultSchema.safeParse({ ...played(1, 1, 1), [key]: 1.5 }).success).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(MatchResultSchema.safeParse({ ...played(2, 0), kind: 'conceded' }).success).toBe(false);
  });

  it.each(['intentionalDraw', 'unplayed'] as const)('%s accepts zero games', (kind) => {
    expect(MatchResultSchema.safeParse({ winsA: 0, winsB: 0, draws: 0, kind }).success).toBe(true);
  });

  it.each(['intentionalDraw', 'unplayed'] as const)('%s rejects any game count', (kind) => {
    expect(MatchResultSchema.safeParse({ winsA: 1, winsB: 0, draws: 0, kind }).success).toBe(false);
    expect(MatchResultSchema.safeParse({ winsA: 0, winsB: 1, draws: 0, kind }).success).toBe(false);
    expect(MatchResultSchema.safeParse({ winsA: 0, winsB: 0, draws: 1, kind }).success).toBe(false);
  });

  it('played rejects zero games', () => {
    expect(MatchResultSchema.safeParse(played(0, 0, 0)).success).toBe(false);
  });

  it('played accepts a single drawn game', () => {
    expect(MatchResultSchema.safeParse(played(0, 0, 1)).success).toBe(true);
  });
});

describe('matchOutcome', () => {
  it("returns 'A' when A won more games", () => {
    expect(matchOutcome(played(2, 1))).toBe('A');
  });

  it("returns 'B' when B won more games", () => {
    expect(matchOutcome(played(0, 2))).toBe('B');
  });

  it("returns 'draw' for equal games", () => {
    expect(matchOutcome(played(1, 1, 1))).toBe('draw');
  });

  it("returns 'draw' for an intentional draw", () => {
    expect(matchOutcome({ winsA: 0, winsB: 0, draws: 0, kind: 'intentionalDraw' })).toBe('draw');
  });

  it("returns 'doubleLoss' for an unplayed match", () => {
    expect(matchOutcome({ winsA: 0, winsB: 0, draws: 0, kind: 'unplayed' })).toBe('doubleLoss');
  });
});
