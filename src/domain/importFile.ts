import { z } from 'zod';
import { parseTournamentDocument, unsupportedSchemaVersion } from './document';
import { domainError, type DomainError } from './errors';
import { err, ok, type Result } from './result';
import { DatasetEnvelopeSchema } from './schemas/dataset';
import type { TournamentDocument } from './schemas/document';
import type { Player } from './schemas/player';
import type { TournamentState } from './state';

export type ParsedImport = {
  kind: 'tournament' | 'dataset';
  players: Player[]; // dataset players; [] for a single tournament
  tournaments: Array<{ doc: TournamentDocument; state: TournamentState }>;
};

function isDataset(json: unknown): boolean {
  return (
    typeof json === 'object' &&
    json !== null &&
    'kind' in json &&
    json.kind === 'modotorneo-dataset'
  );
}

function rawId(json: unknown): string {
  return typeof json === 'object' && json !== null && 'id' in json && typeof json.id === 'string'
    ? json.id
    : 'unknown id';
}

/**
 * Validates an untrusted import file. An object with `kind: 'modotorneo-dataset'` is a dataset;
 * anything else is parsed as a single `TournamentDocument`. One invalid tournament rejects
 * the whole dataset.
 */
export function parseImportFile(json: unknown): Result<ParsedImport, DomainError> {
  if (!isDataset(json)) {
    const parsed = parseTournamentDocument(json);
    return parsed.ok
      ? ok({ kind: 'tournament', players: [], tournaments: [parsed.value] })
      : parsed;
  }

  const unsupported = unsupportedSchemaVersion(json);
  if (unsupported) {
    return err(unsupported);
  }
  const envelope = DatasetEnvelopeSchema.safeParse(json);
  if (!envelope.success) {
    return err(domainError('INVALID_SCHEMA', z.prettifyError(envelope.error)));
  }

  const tournaments: ParsedImport['tournaments'] = [];
  const seen = new Set<string>();
  for (const [index, raw] of envelope.data.tournaments.entries()) {
    const parsed = parseTournamentDocument(raw);
    if (!parsed.ok) {
      const { code, message, seq } = parsed.error;
      return err(domainError(code, `Tournament ${index} (${rawId(raw)}): ${message}`, seq));
    }
    const { id } = parsed.value.doc;
    if (seen.has(id)) {
      return err(
        domainError('INVALID_SCHEMA', `Tournament ${index} (${id}): duplicate tournament id`),
      );
    }
    seen.add(id);
    tournaments.push(parsed.value);
  }
  return ok({ kind: 'dataset', players: envelope.data.players, tournaments });
}
