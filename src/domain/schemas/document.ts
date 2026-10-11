import { z } from 'zod';
import { UuidSchema } from './common';
import { TournamentEventSchema } from './events';

/** Persisted tournament: the event log only. State is always derived. */
export const TournamentDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  id: UuidSchema, // the tournament id
  events: z.array(TournamentEventSchema),
});
export type TournamentDocument = z.infer<typeof TournamentDocumentSchema>;
