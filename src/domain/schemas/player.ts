import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from './common';

/** Global, cross-tournament player. */
export const PlayerSchema = z.object({
  id: UuidSchema,
  name: z.string().trim().min(1).max(100),
  createdAt: IsoDateTimeSchema,
});
export type Player = z.infer<typeof PlayerSchema>;
