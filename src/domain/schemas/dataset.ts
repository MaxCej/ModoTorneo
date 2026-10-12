import { z } from 'zod';
import { IsoDateTimeSchema } from './common';
import { TournamentDocumentSchema } from './document';
import { PlayerSchema } from './player';

function hasUniqueIds(items: ReadonlyArray<{ id: string }>): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

/** Full-dataset export file: every player and every tournament. */
export const DatasetSchema = z.object({
  kind: z.literal('modotorneo-dataset'),
  schemaVersion: z.literal(1),
  exportedAt: IsoDateTimeSchema,
  players: z.array(PlayerSchema).refine(hasUniqueIds, 'Duplicate player id'),
  tournaments: z.array(TournamentDocumentSchema).refine(hasUniqueIds, 'Duplicate tournament id'),
});
export type Dataset = z.infer<typeof DatasetSchema>;

/**
 * The dataset without its tournaments checked: `parseImportFile` parses each one on its own,
 * so an error names the tournament and keeps its `parseTournamentDocument` code.
 */
export const DatasetEnvelopeSchema = DatasetSchema.extend({
  tournaments: z.array(z.unknown()),
});
