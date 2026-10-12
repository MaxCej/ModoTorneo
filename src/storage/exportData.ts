import { err, ok, type Dataset, type IsoDate, type IsoDateTime, type Result } from '../domain';
import type { StorageBackend, StorageError } from './types';

const SLUG_MAX_LENGTH = 50;

/** Lower-cased name, every run outside `a-z0-9` replaced by `-`, no leading or trailing `-`. */
function slug(name: string): string {
  const trimDashes = (value: string) => value.replace(/^-+|-+$/g, '');
  const full = trimDashes(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  // Trimmed again so the cut cannot leave a trailing `-`.
  return trimDashes(full.slice(0, SLUG_MAX_LENGTH)) || 'tournament';
}

/** `modotorneo-<slug>-<date>.json` for a single-tournament export. */
export function tournamentFileName(name: string, date: IsoDate): string {
  return `modotorneo-${slug(name)}-${date}.json`;
}

/** `modotorneo-backup-<YYYY-MM-DD>.json`, using the UTC date of `exportedAt`. */
export function datasetFileName(exportedAt: IsoDateTime): string {
  return `modotorneo-backup-${new Date(exportedAt).toISOString().slice(0, 10)}.json`;
}

/** Every stored tournament and player, wrapped as a dataset file. */
export async function buildDataset(
  backend: StorageBackend,
  now: () => IsoDateTime = () => new Date().toISOString(),
): Promise<Result<Dataset, StorageError>> {
  const players = await backend.listPlayers();
  if (!players.ok) {
    return players;
  }
  const summaries = await backend.listTournaments();
  if (!summaries.ok) {
    return summaries;
  }
  const tournaments: Dataset['tournaments'] = [];
  for (const summary of summaries.value) {
    const loaded = await backend.loadTournament(summary.id);
    if (!loaded.ok) {
      return err(loaded.error);
    }
    tournaments.push(loaded.value.doc);
  }
  return ok({
    kind: 'modotorneo-dataset',
    schemaVersion: 1,
    exportedAt: now(),
    players: players.value,
    tournaments,
  });
}
