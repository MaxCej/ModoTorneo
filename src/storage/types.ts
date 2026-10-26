import type {
  DomainError,
  Format,
  IsoDate,
  IsoDateTime,
  Player,
  Result,
  TournamentDocument,
  TournamentState,
  TournamentStatus,
  Uuid,
} from '../domain';

/** Opaque. Dexie: integer counter as string ("1", "2"…). GitHub: blob SHA of the file. */
export type Revision = string;

export type TournamentSummary = {
  id: Uuid;
  name: string;
  date: IsoDate;
  format: Format;
  status: TournamentStatus;
  eventCount: number; // doc.events.length, voided events included
  playerCount: number; // every registered player, dropped included (Object.keys(state.players))
  updatedAt: IsoDateTime; // time of the last save
  revision: Revision;
};

export type StoredTournament = {
  doc: TournamentDocument;
  state: TournamentState;
  revision: Revision;
};

export type StorageErrorCode =
  | 'NOT_FOUND' // no tournament with that id
  | 'CONFLICT' // expectedRevision does not match the stored one
  | 'INVALID_DOCUMENT' // parseTournamentDocument failed; `cause` holds the DomainError
  | 'INVALID_PLAYER' // PlayerSchema failed on save or load; `cause` holds the DomainError
  | 'UNAUTHORIZED' // GitHub answered 401, or 403 without rate-limit headers
  | 'UNAVAILABLE'; // IndexedDB failure, network error, GitHub 5xx or rate limit

export type StorageError = { code: StorageErrorCode; message: string; cause?: DomainError };

export interface StorageBackend {
  /** Sorted by date descending, then name ascending. */
  listTournaments(): Promise<Result<TournamentSummary[], StorageError>>;
  loadTournament(id: Uuid): Promise<Result<StoredTournament, StorageError>>;
  /** `expectedRevision` null creates the tournament. */
  saveTournament(
    doc: TournamentDocument,
    expectedRevision: Revision | null,
  ): Promise<Result<{ revision: Revision; summary: TournamentSummary }, StorageError>>;
  deleteTournament(id: Uuid, expectedRevision: Revision): Promise<Result<void, StorageError>>;
  /** Sorted by name ascending. */
  listPlayers(): Promise<Result<Player[], StorageError>>;
  /** Upsert by id. */
  savePlayer(player: Player): Promise<Result<void, StorageError>>;
}
