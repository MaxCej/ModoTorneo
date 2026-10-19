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
} from '../../domain';
import { toSummary } from '../summary';
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

function notImplemented(): Promise<Result<never, StorageError>> {
  return Promise.resolve(err({ code: 'UNAVAILABLE', message: 'Not implemented yet' }));
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

  constructor(options: GitHubBackendOptions) {
    this.client = new GitHubClient(options);
  }

  listTournaments(): Promise<Result<TournamentSummary[], StorageError>> {
    return notImplemented();
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
    if (!deleted.ok && deleted.error.code === 'NOT_FOUND') {
      return err({ code: 'NOT_FOUND', message: `No tournament with id ${id}` });
    }
    return deleted;
  }

  listPlayers(): Promise<Result<Player[], StorageError>> {
    return notImplemented();
  }

  savePlayer(player: Player): Promise<Result<void, StorageError>> {
    void player;
    return notImplemented();
  }
}
