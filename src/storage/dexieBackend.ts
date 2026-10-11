import {
  err,
  ok,
  parseTournamentDocument,
  type DomainError,
  type IsoDateTime,
  type Result,
  type TournamentDocument,
  type Uuid,
} from '../domain';
import { ModoTorneoDb, type TournamentRow } from './db';
import { toSummary } from './summary';
import type { Revision, StorageError, StoredTournament, TournamentSummary } from './types';

export type DexieBackendOptions = { dbName?: string; now?: () => IsoDateTime };

function notFound(id: Uuid): StorageError {
  return { code: 'NOT_FOUND', message: `No tournament with id ${id}` };
}

function staleRevision(id: Uuid, stored: number, expected: Revision): StorageError {
  return {
    code: 'CONFLICT',
    message: `Tournament ${id} is at revision ${stored}, expected ${expected}`,
  };
}

function invalidDocument(message: string, cause: DomainError): StorageError {
  return { code: 'INVALID_DOCUMENT', message: `${message}: ${cause.message}`, cause };
}

function rowSummary(row: TournamentRow): TournamentSummary {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    format: row.format,
    status: row.status,
    eventCount: row.eventCount,
    updatedAt: row.updatedAt,
    revision: String(row.revision),
  };
}

/** Local backend: IndexedDB through Dexie. Every document is validated on save and on load. */
export class DexieBackend {
  private readonly db: ModoTorneoDb;
  private readonly now: () => IsoDateTime;

  constructor(options: DexieBackendOptions = {}) {
    this.db = new ModoTorneoDb(options.dbName);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Maps anything thrown (database cannot open, transaction aborted) to `UNAVAILABLE`. */
  private async run<T>(
    operation: () => Promise<Result<T, StorageError>>,
  ): Promise<Result<T, StorageError>> {
    try {
      return await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err({ code: 'UNAVAILABLE', message });
    }
  }

  listTournaments(): Promise<Result<TournamentSummary[], StorageError>> {
    return this.run(async () => {
      const rows = await this.db.tournaments.toArray();
      rows.sort((a, b) =>
        a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? 1 : -1,
      );
      return ok(rows.map(rowSummary));
    });
  }

  loadTournament(id: Uuid): Promise<Result<StoredTournament, StorageError>> {
    return this.run(async () => {
      const row = await this.db.tournaments.get(id);
      if (!row) {
        return err(notFound(id));
      }
      const parsed = parseTournamentDocument(row.doc);
      if (!parsed.ok) {
        return err(invalidDocument(`Stored tournament ${id} is invalid`, parsed.error));
      }
      return ok({ ...parsed.value, revision: String(row.revision) });
    });
  }

  saveTournament(
    doc: TournamentDocument,
    expectedRevision: Revision | null,
  ): Promise<Result<{ revision: Revision; summary: TournamentSummary }, StorageError>> {
    return this.run(async () => {
      const parsed = parseTournamentDocument(doc);
      if (!parsed.ok) {
        return err(invalidDocument('Invalid tournament document', parsed.error));
      }
      const { doc: valid, state } = parsed.value;
      // Revision check and write in one transaction, so two tabs cannot both win.
      return this.db.transaction('rw', this.db.tournaments, async () => {
        const existing = await this.db.tournaments.get(valid.id);
        if (expectedRevision === null && existing) {
          return err<StorageError>({
            code: 'CONFLICT',
            message: `Tournament ${valid.id} already exists`,
          });
        }
        if (expectedRevision !== null) {
          if (!existing) {
            return err(notFound(valid.id));
          }
          if (String(existing.revision) !== expectedRevision) {
            return err(staleRevision(valid.id, existing.revision, expectedRevision));
          }
        }
        const revision = (existing?.revision ?? 0) + 1;
        const summary = toSummary(valid, state, String(revision), this.now());
        await this.db.tournaments.put({ ...summary, doc: valid, revision });
        return ok({ revision: summary.revision, summary });
      });
    });
  }

  deleteTournament(id: Uuid, expectedRevision: Revision): Promise<Result<void, StorageError>> {
    return this.run(() =>
      this.db.transaction('rw', this.db.tournaments, async () => {
        const existing = await this.db.tournaments.get(id);
        if (!existing) {
          return err(notFound(id));
        }
        if (String(existing.revision) !== expectedRevision) {
          return err(staleRevision(id, existing.revision, expectedRevision));
        }
        await this.db.tournaments.delete(id);
        return ok(undefined);
      }),
    );
  }
}
