import { z } from 'zod';

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
