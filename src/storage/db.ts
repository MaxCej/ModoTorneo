import Dexie, { type EntityTable, type Table } from 'dexie';
import {
  parseTournamentDocument,
  playerResults,
  tournamentArchetypes,
  type Format,
  type IsoDate,
  type IsoDateTime,
  type Player,
  type PlayerResult,
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
  players: PlayerResult[]; // added in version 4
  archetypes: string[]; // added in version 5
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

/** Player results of a stored document. An invalid doc gets none and still fails on load. */
function playerResultsOf(doc: unknown): PlayerResult[] {
  const parsed = parseTournamentDocument(doc);
  return parsed.ok ? playerResults(parsed.value.state) : [];
}

/** Summary fields that need decks (version 5). An invalid doc gets none and still fails on load. */
function deckFieldsOf(doc: unknown): Pick<TournamentRow, 'players' | 'archetypes'> {
  const parsed = parseTournamentDocument(doc);
  return parsed.ok
    ? {
        players: playerResults(parsed.value.state),
        archetypes: tournamentArchetypes(parsed.value.state),
      }
    : { players: [], archetypes: [] };
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
    // Version 4: same indexes, adds `players` to every row and clears the GitHub summary cache,
    // whose rows have no `players` yet; the next list recomputes them from the files.
    this.version(4)
      .stores({ ...stores, githubSummaries: '[repo+id]' })
      .upgrade(async (tx) => {
        await tx
          .table<TournamentRow, Uuid>('tournaments')
          .toCollection()
          .modify((row) => {
            row.players = playerResultsOf(row.doc);
          });
        await tx.table('githubSummaries').clear();
      });
    // Version 5: same indexes. Recomputes `players` (now with `archetype`), adds `archetypes`,
    // and clears the GitHub summary cache again for the same reason as version 4.
    this.version(5)
      .stores({ ...stores, githubSummaries: '[repo+id]' })
      .upgrade(async (tx) => {
        await tx
          .table<TournamentRow, Uuid>('tournaments')
          .toCollection()
          .modify((row) => {
            Object.assign(row, deckFieldsOf(row.doc));
          });
        await tx.table('githubSummaries').clear();
      });
  }
}
