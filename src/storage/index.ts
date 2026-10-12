import { DexieBackend } from './dexieBackend';
import type { StorageBackend } from './types';

let storage: StorageBackend | null = null;

/** The app's storage backend. Local Dexie only until SPEC 09 adds backend selection. */
export function getStorage(): StorageBackend {
  storage ??= new DexieBackend();
  return storage;
}

export { DexieBackend, type DexieBackendOptions } from './dexieBackend';
export { downloadJson } from './download';
export { buildDataset, datasetFileName, tournamentFileName } from './exportData';
export {
  applyImport,
  planImport,
  readImportFile,
  type ConflictChoice,
  type ImportOutcome,
  type ImportPlan,
  type ImportPlanItem,
  type ImportSummary,
} from './importData';
export { getPersistence, requestPersistence, type PersistenceStatus } from './persist';
export type {
  Revision,
  StorageBackend,
  StorageError,
  StorageErrorCode,
  StoredTournament,
  TournamentSummary,
} from './types';
