import { z } from 'zod';

/** Stored as typed (trimmed, inner spaces collapsed by the parser); not resolved against card data. */
export const CardNameSchema = z.string().trim().min(1).max(150);
export const ArchetypeSchema = z.string().trim().min(1).max(60);

export const DeckCardSchema = z.object({
  quantity: z.number().int().min(1).max(99),
  name: CardNameSchema,
});
export type DeckCard = z.infer<typeof DeckCardSchema>;

/** A player's deck in one tournament. Lists hold distinct names (case-insensitive) per section. */
export const DeckSchema = z.object({
  archetype: ArchetypeSchema.optional(),
  main: z.array(DeckCardSchema).max(250),
  sideboard: z.array(DeckCardSchema).max(100),
});
export type Deck = z.infer<typeof DeckSchema>;
