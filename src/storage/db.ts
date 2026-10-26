import Dexie, { type EntityTable, type Table } from 'dexie';
import {
  parseTournamentDocument,
  type Format,
  type IsoDate,
  type IsoDateTime,
  type Player,
  type TournamentDocument,
  type TournamentStatus,
  type Uuid,
} from '../domain';
import type { TournamentSummary } from './types';

export const DEFAULT_DB_NAME = 'modotorneo';

export type TournamentRow = {
  id: Uuid;
  doc: TournamentDocument; // source of truth
  revision: number; // exposed as String(revision)
  // Summary fields, always recomputed from `reduce` on save.
  name: string;
  date: IsoDate;
  format: Format;
  status: TournamentStatus;
  eventCount: number;
  playerCount: number; // added in version 2
  updatedAt: IsoDateTime;
};

export type PlayerRow = Player;

/** Cached summary of one GitHub tournament file, valid while the file's blob SHA matches. */
export type GitHubSummaryRow = {
  repo: string; // "owner/repo", lower case
  id: Uuid;
  sha: string; // blob SHA the summary was computed from
  summary: TournamentSummary;
};

/** Registered players of a stored document. An invalid doc gets 0 and still fails on load. */
function playerCountOf(doc: unknown): number {
  const parsed = parseTournamentDocument(doc);
  return parsed.ok ? Object.keys(parsed.value.state.players).length : 0;
}

export class ModoTorneoDb extends Dexie {
  // `declare` keeps class field initializers from overwriting the tables Dexie assigns.
  declare tournaments: EntityTable<TournamentRow, 'id'>;
  declare players: EntityTable<PlayerRow, 'id'>;
  declare githubSummaries: Table<GitHubSummaryRow, [string, Uuid]>;

  constructor(name: string = DEFAULT_DB_NAME) {
    super(name);
    const stores = {
      tournaments: 'id, date, format, status, updatedAt',
      players: 'id, name',
    };
    this.version(1).stores(stores);
    // Version 2: same indexes, adds `playerCount` to every existing row.
    this.version(2)
      .stores(stores)
      .upgrade((tx) =>
        tx
          .table<TournamentRow, Uuid>('tournaments')
          .toCollection()
          .modify((row) => {
            row.playerCount = playerCountOf(row.doc);
          }),
      );
    // Version 3: the GitHub summary cache. Existing tables unchanged, nothing to upgrade.
    this.version(3).stores({ ...stores, githubSummaries: '[repo+id]' });
  }
}
