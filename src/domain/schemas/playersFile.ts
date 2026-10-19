import { z } from 'zod';
import { domainError, type DomainError } from '../errors';
import { err, ok, type Result } from '../result';
import { PlayerSchema } from './player';

/** `players.json` in the GitHub data repository. Players are sorted by id when written. */
export const PlayersFileSchema = z.object({
  kind: z.literal('modotorneo-players'),
  schemaVersion: z.literal(1),
  players: z
    .array(PlayerSchema)
    .refine((players) => new Set(players.map((p) => p.id)).size === players.length, {
      message: 'Duplicate player id',
    }),
});
export type PlayersFile = z.infer<typeof PlayersFileSchema>;

/** Validates untrusted JSON as a players file; failure is `INVALID_SCHEMA`. */
export function parsePlayersFile(json: unknown): Result<PlayersFile, DomainError> {
  const parsed = PlayersFileSchema.safeParse(json);
  return parsed.success
    ? ok(parsed.data)
    : err(domainError('INVALID_SCHEMA', z.prettifyError(parsed.error)));
}
