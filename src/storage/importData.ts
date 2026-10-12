import {
  compareLogs,
  err,
  newId as defaultNewId,
  ok,
  parseImportFile,
  playersFromDocument,
  type DomainError,
  type LogComparison,
  type ParsedImport,
  type Player,
  type Result,
  type TournamentDocument,
  type TournamentState,
  type Uuid,
} from '../domain';
import type { Revision, StorageBackend, StorageError, TournamentSummary } from './types';

export type ImportOutcome = 'new' | 'unchanged' | 'fastForward' | 'olderThanLocal' | 'conflict';
export type ConflictChoice = 'skip' | 'overwrite' | 'copy';

export type ImportPlanItem = {
  doc: TournamentDocument;
  state: TournamentState;
  outcome: ImportOutcome;
  local?: TournamentSummary; // present unless outcome is 'new'
};

export type ImportPlan = {
  items: ImportPlanItem[];
  playersToAdd: Player[]; // every candidate, for display
  datasetPlayers: Player[]; // dataset players not yet stored; always added on apply
};

export type ImportSummary = {
  added: number;
  updated: number;
  unchanged: number;
  olderThanLocal: number;
  skipped: number;
  overwritten: number;
  copied: number;
  playersAdded: number;
  failed: Array<{ tournamentId: Uuid; name: string; error: StorageError }>;
  playersFailed: Array<{ playerId: Uuid; name: string; error: StorageError }>;
};

const OUTCOMES: Record<LogComparison, ImportOutcome> = {
  identical: 'unchanged',
  incomingAhead: 'fastForward',
  localAhead: 'olderThanLocal',
  diverged: 'conflict',
};

/** Reads and validates a picked file. Text that is not JSON is `INVALID_SCHEMA`. */
export async function readImportFile(file: File): Promise<Result<ParsedImport, DomainError>> {
  const text = await file.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return err<DomainError>({
      code: 'INVALID_SCHEMA',
      message: `The file is not valid JSON: ${reason}`,
    });
  }
  return parseImportFile(json);
}

function uniqueById(players: Player[]): Player[] {
  const byId = new Map<Uuid, Player>();
  for (const player of players) {
    if (!byId.has(player.id)) {
      byId.set(player.id, player);
    }
  }
  return [...byId.values()];
}

/** Classifies every imported tournament against local data. Saves nothing. */
export async function planImport(
  backend: StorageBackend,
  parsed: ParsedImport,
): Promise<Result<ImportPlan, StorageError>> {
  const players = await backend.listPlayers();
  if (!players.ok) {
    return players;
  }
  const summaries = await backend.listTournaments();
  if (!summaries.ok) {
    return summaries;
  }
  const localById = new Map(summaries.value.map((summary) => [summary.id, summary]));

  const items: ImportPlanItem[] = [];
  for (const { doc, state } of parsed.tournaments) {
    const local = localById.get(doc.id);
    if (!local) {
      items.push({ doc, state, outcome: 'new' });
      continue;
    }
    const loaded = await backend.loadTournament(doc.id);
    if (!loaded.ok) {
      return err(loaded.error);
    }
    const outcome = OUTCOMES[compareLogs(loaded.value.doc.events, doc.events)];
    items.push({ doc, state, outcome, local });
  }

  const stored = new Set(players.value.map((player) => player.id));
  const notStored = (player: Player) => !stored.has(player.id);
  const fromItems = items.flatMap((item) => playersFromDocument(item.doc, item.state));
  return ok({
    items,
    playersToAdd: uniqueById([...parsed.players, ...fromItems]).filter(notStored),
    datasetPlayers: parsed.players.filter(notStored),
  });
}

/**
 * Applies a plan. Each tournament save is atomic on its own: a failed save is reported
 * in `failed` and the other items still apply. A failed player save goes to `playersFailed`.
 */
export async function applyImport(
  backend: StorageBackend,
  plan: ImportPlan,
  choices: Record<Uuid, ConflictChoice>,
  deps: { newId: () => Uuid } = { newId: defaultNewId },
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    added: 0,
    updated: 0,
    unchanged: 0,
    olderThanLocal: 0,
    skipped: 0,
    overwritten: 0,
    copied: 0,
    playersAdded: 0,
    failed: [],
    playersFailed: [],
  };
  const savedPlayerIds = new Set<Uuid>();

  for (const item of plan.items) {
    const save = async (
      doc: TournamentDocument,
      revision: Revision | null,
      counter: 'added' | 'updated' | 'overwritten' | 'copied',
    ) => {
      const result = await backend.saveTournament(doc, revision);
      if (!result.ok) {
        summary.failed.push({
          tournamentId: item.doc.id,
          name: item.state.name,
          error: result.error,
        });
        return;
      }
      summary[counter] += 1;
      for (const player of playersFromDocument(item.doc, item.state)) {
        savedPlayerIds.add(player.id);
      }
    };
    const localRevision = item.local?.revision ?? null;

    switch (item.outcome) {
      case 'new':
        await save(item.doc, null, 'added');
        break;
      case 'unchanged':
        summary.unchanged += 1;
        break;
      case 'fastForward':
        await save(item.doc, localRevision, 'updated');
        break;
      case 'olderThanLocal':
        summary.olderThanLocal += 1;
        break;
      case 'conflict': {
        const choice = choices[item.doc.id] ?? 'skip';
        if (choice === 'skip') {
          summary.skipped += 1;
        } else if (choice === 'overwrite') {
          await save(item.doc, localRevision, 'overwritten');
        } else {
          // A copy keeps every event unchanged. Only the tournament id changes.
          await save({ ...item.doc, id: deps.newId() }, null, 'copied');
        }
        break;
      }
    }
  }

  const datasetIds = new Set(plan.datasetPlayers.map((player) => player.id));
  for (const player of plan.playersToAdd) {
    if (!datasetIds.has(player.id) && !savedPlayerIds.has(player.id)) {
      continue;
    }
    const result = await backend.savePlayer(player);
    if (result.ok) {
      summary.playersAdded += 1;
    } else {
      // Reported, not retried: a re-import leaves an unchanged tournament's players alone.
      summary.playersFailed.push({ playerId: player.id, name: player.name, error: result.error });
    }
  }
  return summary;
}
