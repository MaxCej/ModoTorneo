import Dexie from 'dexie';
import {
  err,
  ok,
  parseTournamentDocument,
  type DomainError,
  type IsoDateTime,
  type Player,
  type Result,
  type TournamentDocument,
  type TournamentState,
  type Uuid,
  parsePlayersFile,
  type PlayersFile,
  UuidSchema,
} from '../../domain';
import { ModoTorneoDb, type GitHubSummaryRow } from '../db';
import { parsePlayer } from '../dexieBackend';
import { comparePlayers, compareSummaries, toSummary } from '../summary';
import type {
  Revision,
  StorageBackend,
  StorageError,
  StoredTournament,
  TournamentSummary,
} from '../types';
import { GitHubClient } from './client';

export type GitHubBackendOptions = {
  owner: string;
  repo: string;
  token: string;
  fetch?: typeof fetch; // injected in tests
  dbName?: string; // summary cache database, as DexieBackend
};

export const TOURNAMENTS_DIR = 'tournaments';

/** Parallel file reads while refreshing the tournament list. */
const MAX_PARALLEL_READS = 4;

/** The id of a `<uuid>.json` file name, else null (the file is ignored). */
function tournamentIdOf(name: string): Uuid | null {
  const match = /^(.+)\.json$/.exec(name);
  return match && UuidSchema.safeParse(match[1]).success ? match[1]! : null;
}

/** `Promise.all` over `items` with at most `limit` calls running at once, results in order. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  call: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await call(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function tournamentPath(id: Uuid): string {
  return `${TOURNAMENTS_DIR}/${id}.json`;
}

/** File content: the SPEC 03 export of the document, with a final newline. */
export function tournamentFileText(doc: TournamentDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function invalidDocument(message: string, cause: DomainError): StorageError {
  return { code: 'INVALID_DOCUMENT', message: `${message}: ${cause.message}`, cause };
}

export const PLAYERS_PATH = 'players.json';

/** `players.json` content: players sorted by id, so diffs stay small. */
export function playersFileText(players: readonly Player[]): string {
  const file: PlayersFile = {
    kind: 'modotorneo-players',
    schemaVersion: 1,
    players: [...players].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

function invalidPlayers(cause: DomainError): StorageError {
  return { code: 'INVALID_PLAYER', message: `${PLAYERS_PATH} is invalid: ${cause.message}`, cause };
}

/** Latest `at` among the events: the summary's `updatedAt`, computable from the file alone. */
function latestEventAt(doc: TournamentDocument): IsoDateTime {
  let latest = doc.events[0]!.at;
  for (const event of doc.events) {
    if (Date.parse(event.at) > Date.parse(latest)) {
      latest = event.at;
    }
  }
  return latest;
}

export function githubSummary(
  doc: TournamentDocument,
  state: TournamentState,
  sha: string,
): TournamentSummary {
  return toSummary(doc, state, sha, latestEventAt(doc));
}

/** Parses a tournament file's text; the id inside must match the file name. */
export function parseTournamentFile(
  path: string,
  id: Uuid,
  text: string,
): Result<{ doc: TournamentDocument; state: TournamentState }, StorageError> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(invalidDocument(`${path} is invalid`, { code: 'INVALID_SCHEMA', message }));
  }
  const parsed = parseTournamentDocument(json);
  if (!parsed.ok) {
    return err(invalidDocument(`${path} is invalid`, parsed.error));
  }
  if (parsed.value.doc.id !== id) {
    return err(
      invalidDocument(`${path} is invalid`, {
        code: 'INVALID_SCHEMA',
        message: `File holds tournament ${parsed.value.doc.id}`,
      }),
    );
  }
  return ok(parsed.value);
}

/**
 * GitHub backend: one JSON file per tournament and one `players.json` in a data repository,
 * written through the Contents API. The blob SHA is the revision; GitHub checks it on write.
 */
export class GitHubBackend implements StorageBackend {
  private readonly client: GitHubClient;
  private readonly db: ModoTorneoDb;
  private readonly repoKey: string;

  constructor(options: GitHubBackendOptions) {
    this.client = new GitHubClient(options);
    this.db = new ModoTorneoDb(options.dbName);
    this.repoKey = `${options.owner}/${options.repo}`.toLowerCase();
  }

  /** Cached rows of this repository. The cache is only a speed-up: a failure reads as empty. */
  private async cachedRows(): Promise<Map<Uuid, GitHubSummaryRow>> {
    try {
      const rows = await this.db.githubSummaries
        .where('[repo+id]')
        .between([this.repoKey, Dexie.minKey], [this.repoKey, Dexie.maxKey])
        .toArray();
      return new Map(rows.map((row) => [row.id, row]));
    } catch {
      return new Map();
    }
  }

  private async updateCache(put: GitHubSummaryRow[], remove: Uuid[]): Promise<void> {
    try {
      await this.db.transaction('rw', this.db.githubSummaries, async () => {
        await this.db.githubSummaries.bulkDelete(remove.map((id) => [this.repoKey, id]));
        await this.db.githubSummaries.bulkPut(put);
      });
    } catch {
      // The next list refetches whatever the cache misses.
    }
  }

  private cacheRow(summary: TournamentSummary): GitHubSummaryRow {
    return { repo: this.repoKey, id: summary.id, sha: summary.revision, summary };
  }

  async listTournaments(): Promise<Result<TournamentSummary[], StorageError>> {
    const listing = await this.client.listDirectory(TOURNAMENTS_DIR);
    if (!listing.ok && listing.error.code !== 'NOT_FOUND') {
      return listing;
    }
    const files = (listing.ok ? listing.value : []).flatMap((entry) => {
      const id = entry.type === 'file' ? tournamentIdOf(entry.name) : null;
      return id === null ? [] : [{ id, path: entry.path, sha: entry.sha }];
    });
    const cached = await this.cachedRows();
    const summaries: TournamentSummary[] = [];
    const stale: Array<{ id: Uuid; path: string }> = [];
    for (const file of files) {
      const row = cached.get(file.id);
      if (row && row.sha === file.sha) {
        summaries.push(row.summary);
      } else {
        stale.push(file);
      }
    }
    const fetched = await mapLimit(stale, MAX_PARALLEL_READS, async ({ id, path }) => {
      const read = await this.client.readFile(path);
      if (!read.ok) {
        return read;
      }
      const parsed = parseTournamentFile(path, id, read.value.text);
      return parsed.ok
        ? ok(githubSummary(parsed.value.doc, parsed.value.state, read.value.sha))
        : parsed;
    });
    const failed = fetched.find((result) => !result.ok);
    if (failed && !failed.ok) {
      return failed;
    }
    const fresh = fetched.flatMap((result) => (result.ok ? [result.value] : []));
    const listed = new Set(files.map((file) => file.id));
    await this.updateCache(
      fresh.map((summary) => this.cacheRow(summary)),
      [...cached.keys()].filter((id) => !listed.has(id)),
    );
    return ok([...summaries, ...fresh].sort(compareSummaries));
  }

  async loadTournament(id: Uuid): Promise<Result<StoredTournament, StorageError>> {
    const path = tournamentPath(id);
    const file = await this.client.readFile(path);
    if (!file.ok) {
      return file.error.code === 'NOT_FOUND'
        ? err({ code: 'NOT_FOUND', message: `No tournament with id ${id}` })
        : file;
    }
    const parsed = parseTournamentFile(path, id, file.value.text);
    if (!parsed.ok) {
      return parsed;
    }
    return ok({ ...parsed.value, revision: file.value.sha });
  }

  async saveTournament(
    doc: TournamentDocument,
    expectedRevision: Revision | null,
  ): Promise<Result<{ revision: Revision; summary: TournamentSummary }, StorageError>> {
    const parsed = parseTournamentDocument(doc);
    if (!parsed.ok) {
      return err(invalidDocument('Invalid tournament document', parsed.error));
    }
    const { doc: valid, state } = parsed.value;
    const written = await this.client.writeFile(
      tournamentPath(valid.id),
      tournamentFileText(valid),
      expectedRevision,
      `Save ${state.name} (${valid.events.length} events)`,
    );
    if (!written.ok) {
      return written;
    }
    const summary = githubSummary(valid, state, written.value.sha);
    await this.updateCache([this.cacheRow(summary)], []);
    return ok({ revision: summary.revision, summary });
  }

  async deleteTournament(
    id: Uuid,
    expectedRevision: Revision,
  ): Promise<Result<void, StorageError>> {
    // Read first for the commit message; GitHub still checks `expectedRevision` on delete.
    const loaded = await this.loadTournament(id);
    if (!loaded.ok && loaded.error.code !== 'INVALID_DOCUMENT') {
      return loaded;
    }
    const name = loaded.ok ? loaded.value.state.name : id;
    const deleted = await this.client.deleteFile(
      tournamentPath(id),
      expectedRevision,
      `Delete ${name}`,
    );
    if (!deleted.ok) {
      return deleted.error.code === 'NOT_FOUND'
        ? err({ code: 'NOT_FOUND', message: `No tournament with id ${id}` })
        : deleted;
    }
    await this.updateCache([], [id]);
    return deleted;
  }

  /** `players.json` and its SHA; a missing file is an empty list with SHA null. */
  private async readPlayers(): Promise<
    Result<{ players: Player[]; sha: string | null }, StorageError>
  > {
    const file = await this.client.readFile(PLAYERS_PATH);
    if (!file.ok) {
      return file.error.code === 'NOT_FOUND' ? ok({ players: [], sha: null }) : file;
    }
    let json: unknown;
    try {
      json = JSON.parse(file.value.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(invalidPlayers({ code: 'INVALID_SCHEMA', message }));
    }
    const parsed = parsePlayersFile(json);
    if (!parsed.ok) {
      return err(invalidPlayers(parsed.error));
    }
    return ok({ players: parsed.value.players, sha: file.value.sha });
  }

  async listPlayers(): Promise<Result<Player[], StorageError>> {
    const read = await this.readPlayers();
    if (!read.ok) {
      return read;
    }
    return ok([...read.value.players].sort(comparePlayers));
  }

  async savePlayer(player: Player): Promise<Result<void, StorageError>> {
    const parsed = parsePlayer(player, 'Invalid player');
    if (!parsed.ok) {
      return parsed;
    }
    const valid = parsed.value;
    // Upserts by id merge cleanly, so one conflict is retried on a fresh read; a second is returned.
    let written: Result<{ sha: string }, StorageError> | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const read = await this.readPlayers();
      if (!read.ok) {
        return read;
      }
      const players = [...read.value.players.filter((p) => p.id !== valid.id), valid];
      written = await this.client.writeFile(
        PLAYERS_PATH,
        playersFileText(players),
        read.value.sha,
        `Save player ${valid.name}`,
      );
      if (written.ok || written.error.code !== 'CONFLICT') {
        break;
      }
    }
    return written!.ok ? ok(undefined) : written!;
  }
}
