import { z } from 'zod';
import { CorruptLogError, domainError, type DomainError } from './errors';
import { reduce } from './reduce';
import { err, ok, type Result } from './result';
import { TournamentDocumentSchema, type TournamentDocument } from './schemas/document';
import type { TournamentState } from './state';

/**
 * A newer integer `schemaVersion` was saved by a newer app: `UNSUPPORTED_SCHEMA_VERSION`.
 * Anything else that is not 1 is a broken file, left for the schema to report as `INVALID_SCHEMA`.
 */
export function unsupportedSchemaVersion(json: unknown): DomainError | null {
  if (typeof json === 'object' && json !== null && 'schemaVersion' in json) {
    const { schemaVersion } = json;
    if (
      typeof schemaVersion === 'number' &&
      Number.isInteger(schemaVersion) &&
      schemaVersion >= 2
    ) {
      return domainError(
        'UNSUPPORTED_SCHEMA_VERSION',
        `Unsupported schemaVersion ${schemaVersion}`,
      );
    }
  }
  return null;
}

/**
 * Validates untrusted JSON (an imported file, GitHub data) as a tournament document and
 * replays its log. Any schema failure or broken invariant returns an error instead of a state.
 */
export function parseTournamentDocument(
  json: unknown,
): Result<{ doc: TournamentDocument; state: TournamentState }, DomainError> {
  const unsupported = unsupportedSchemaVersion(json);
  if (unsupported) {
    return err(unsupported);
  }
  const parsed = TournamentDocumentSchema.safeParse(json);
  if (!parsed.success) {
    return err(domainError('INVALID_SCHEMA', z.prettifyError(parsed.error)));
  }
  const doc = parsed.data;
  try {
    return ok({ doc, state: reduce(doc.events, doc.id) });
  } catch (error) {
    if (error instanceof CorruptLogError) {
      return err(error.error);
    }
    throw error;
  }
}
