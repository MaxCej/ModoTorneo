import Dexie, { type EntityTable } from 'dexie';
import type {
  Format,
  IsoDate,
  IsoDateTime,
  Player,
  TournamentDocument,
  TournamentStatus,
  Uuid,
} from '../domain';

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
  updatedAt: IsoDateTime;
};

export type PlayerRow = Player;

export class ModoTorneoDb extends Dexie {
  // `declare` keeps class field initializers from overwriting the tables Dexie assigns.
  declare tournaments: EntityTable<TournamentRow, 'id'>;
  declare players: EntityTable<PlayerRow, 'id'>;

  constructor(name: string = DEFAULT_DB_NAME) {
    super(name);
    this.version(1).stores({
      tournaments: 'id, date, format, status, updatedAt',
      players: 'id, name',
    });
  }
}
