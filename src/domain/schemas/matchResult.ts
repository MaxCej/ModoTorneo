import { z } from 'zod';
import type { BestOf } from './common';

const GameCountSchema = z.number().int().min(0).max(3);

export const MatchResultSchema = z
  .object({
    winsA: GameCountSchema,
    winsB: GameCountSchema,
    draws: GameCountSchema,
    kind: z.enum(['played', 'intentionalDraw', 'unplayed']),
  })
  .refine((r) => r.kind === 'played' || (r.winsA === 0 && r.winsB === 0 && r.draws === 0), {
    message: 'intentionalDraw and unplayed results must have zero games',
  })
  .refine((r) => r.kind !== 'played' || r.winsA + r.winsB + r.draws >= 1, {
    message: 'played results must have at least one game',
  });
export type MatchResult = z.infer<typeof MatchResultSchema>;

export type MatchOutcome = 'A' | 'B' | 'draw' | 'doubleLoss';

/** Derives the match outcome from the game counts. Never stored. */
export function matchOutcome(result: MatchResult): MatchOutcome {
  switch (result.kind) {
    case 'played':
      if (result.winsA > result.winsB) return 'A';
      if (result.winsB > result.winsA) return 'B';
      return 'draw';
    case 'intentionalDraw':
      return 'draw';
    case 'unplayed':
      return 'doubleLoss';
  }
}

/** Implicit result of a bye (`playerB: null`). Byes are never reported. */
export const IMPLICIT_BYE_RESULT: MatchResult = { winsA: 2, winsB: 0, draws: 0, kind: 'played' };

/**
 * Whether a result fits a best-of-`bestOf` match: at most `(bestOf + 1) / 2` wins per player
 * and at most `bestOf` games in total (draws included). Intentional draws and unplayed matches
 * always fit. Stricter than `MatchResultSchema`, which stays loose for stored and imported data.
 */
export function fitsBestOf(result: MatchResult, bestOf: BestOf): boolean {
  if (result.kind !== 'played') {
    return true;
  }
  const maxWins = (bestOf + 1) / 2;
  return (
    result.winsA <= maxWins &&
    result.winsB <= maxWins &&
    result.winsA + result.winsB + result.draws <= bestOf
  );
}
