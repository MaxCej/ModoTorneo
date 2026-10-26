import { z } from 'zod';
import {
  err,
  ok,
  parseTournamentDocument,
  PlayerSchema,
  type DomainError,
  type IsoDateTime,
  type Player,
  type Result,
  type TournamentDocument,
  type Uuid,
} from '../domain';
import { ModoTorneoDb, type TournamentRow } from './db';
import { comparePlayers, compareSummaries, toSummary } from './summary';
import type {
  Revision,
  StorageBackend,
  StorageError,
  StoredTournament,
  TournamentSummary,
} from './types';

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

/** Parses a player with `PlayerSchema`; failure is `INVALID_PLAYER` with an `INVALID_SCHEMA` cause. */
export function parsePlayer(value: unknown, context: string): Result<Player, StorageError> {
  const parsed = PlayerSchema.safeParse(value);
  if (parsed.success) {
    return ok(parsed.data);
  }
  const cause: DomainError = { code: 'INVALID_SCHEMA', message: z.prettifyError(parsed.error) };
  return err({ code: 'INVALID_PLAYER', message: `${context}: ${cause.message}`, cause });
}

function rowSummary(row: TournamentRow): TournamentSummary {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    format: row.format,
    status: row.status,
    eventCount: row.eventCount,
    playerCount: row.playerCount,
    updatedAt: row.updatedAt,
    revision: String(row.revision),
    players: row.players,
    archetypes: row.archetypes,
  };
}

/** Local backend: IndexedDB through Dexie. Every document is validated on save and on load. */
export class DexieBackend implements StorageBackend {
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
      rows.sort(compareSummaries);
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

  listPlayers(): Promise<Result<Player[], StorageError>> {
    return this.run(async () => {
      // Sorted in memory like tournament names: the `name` index orders by code unit, not locale.
      const rows = await this.db.players.toArray();
      // Symmetric with loadTournament: one corrupted row fails the whole call.
      const players: Player[] = [];
      for (const row of rows) {
        const parsed = parsePlayer(row, `Stored player ${String(row.id)} is invalid`);
        if (!parsed.ok) {
          return parsed;
        }
        players.push(parsed.value);
      }
      players.sort(comparePlayers);
      return ok(players);
    });
  }

  savePlayer(player: Player): Promise<Result<void, StorageError>> {
    return this.run(async () => {
      const parsed = parsePlayer(player, 'Invalid player');
      if (!parsed.ok) {
        return parsed;
      }
      // The stored player is the parsed one (name trimmed).
      await this.db.players.put(parsed.value);
      return ok(undefined);
    });
  }
}
