import { DexieBackend } from './dexieBackend';
import { GitHubBackend } from './github/githubBackend';
import { readSettings } from './settings';
import type { StorageBackend } from './types';

let storage: StorageBackend | null = null;

/** The app's storage backend, chosen from the settings once per page load. */
export function getStorage(): StorageBackend {
  if (!storage) {
    const settings = readSettings();
    storage =
      settings.backend === 'github'
        ? new GitHubBackend({ owner: settings.owner, repo: settings.repo, token: settings.token })
        : new DexieBackend();
  }
  return storage;
}

export { DexieBackend, type DexieBackendOptions } from './dexieBackend';
export { downloadJson } from './download';
export { buildDataset, datasetFileName, tournamentFileName } from './exportData';
export { GitHubBackend, type GitHubBackendOptions } from './github/githubBackend';
export { testConnection, type ConnectionCheck } from './github/testConnection';
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
export {
  clearSettings,
  readSettings,
  SETTINGS_KEY,
  StorageSettingsSchema,
  writeSettings,
  type StorageSettings,
} from './settings';
export type {
  Revision,
  StorageBackend,
  StorageError,
  StorageErrorCode,
  StoredTournament,
  TournamentSummary,
} from './types';
