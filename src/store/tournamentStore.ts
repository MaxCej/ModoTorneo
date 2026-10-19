import { create } from 'zustand';
import {
  err,
  executeAll,
  ok,
  type Command,
  type Deps,
  type DomainError,
  type Result,
  type TournamentDocument,
  type TournamentState,
  type Uuid,
} from '../domain';
import { getStorage, type Revision, type StorageBackend, type StorageError } from '../storage';

export type SaveNotice =
  | { kind: 'conflict' } // another tab saved first; reloaded
  | { kind: 'notFound' } // the tournament was deleted elsewhere
  | { kind: 'saveFailed'; error: StorageError };

export type TournamentStoreState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  id: Uuid | null;
  doc: TournamentDocument | null;
  state: TournamentState | null;
  revision: Revision | null; // revision of the last successful save
  loadError: StorageError | null;
  commandError: DomainError | null; // last rejected command, cleared on the next accepted one
  notice: SaveNotice | null;
  saving: boolean; // true while the save queue is not empty
  load(id: Uuid): Promise<void>;
  dispatch(cmd: Command): Result<TournamentState, DomainError>;
  /** Appends every command or none, with one optimistic update and one save. */
  dispatchAll(commands: readonly [Command, ...Command[]]): Result<TournamentState, DomainError>;
  clearNotice(): void;
};

function refused(message: string): Result<TournamentState, DomainError> {
  return err({ code: 'WRONG_STATUS', message });
}

/**
 * The open tournament. `dispatch` and `dispatchAll` apply commands optimistically and queue
 * one save per accepted call. Saves run one at a time, each with the revision returned by the previous one.
 * Any save failure drops the rest of the queue and reloads (or blocks, on NOT_FOUND).
 */
export function createTournamentStore(backend: StorageBackend, deps?: Deps) {
  return create<TournamentStoreState>()((set, get) => {
    // Bumped by load and by every save failure: queued saves from an older generation are dropped.
    let generation = 0;
    let queue: Promise<void> = Promise.resolve();
    let pending = 0;
    let deleted = false; // set by a NOT_FOUND save, cleared by load

    /** Replaces the local copy with the stored one, then shows `notice`. */
    async function reload(id: Uuid, notice: SaveNotice): Promise<void> {
      const result = await backend.loadTournament(id);
      if (result.ok) {
        const { doc, state, revision } = result.value;
        set({ status: 'ready', doc, state, revision, commandError: null, notice });
      } else if (result.error.code === 'NOT_FOUND') {
        deleted = true;
        set({ notice: { kind: 'notFound' } });
      } else {
        set({ status: 'error', loadError: result.error, notice });
      }
    }

    async function save(doc: TournamentDocument, saveGeneration: number): Promise<void> {
      if (saveGeneration !== generation) {
        return;
      }
      const result = await backend.saveTournament(doc, get().revision);
      if (saveGeneration !== generation) {
        return; // load() ran while this save was in flight
      }
      if (result.ok) {
        set({ revision: result.value.revision });
        return;
      }
      generation += 1;
      const { error } = result;
      if (error.code === 'NOT_FOUND') {
        deleted = true;
        set({ notice: { kind: 'notFound' } });
        return;
      }
      await reload(
        doc.id,
        error.code === 'CONFLICT' ? { kind: 'conflict' } : { kind: 'saveFailed', error },
      );
      // Commands dispatched during the reload were built on the stale document.
      generation += 1;
    }

    function enqueue(doc: TournamentDocument): void {
      const saveGeneration = generation;
      pending += 1;
      set({ saving: true });
      queue = queue
        .then(() => save(doc, saveGeneration))
        .catch(() => {}) // the backend reports failures as results; never break the chain
        .finally(() => {
          pending -= 1;
          set({ saving: pending > 0 });
        });
    }

    return {
      status: 'idle',
      id: null,
      doc: null,
      state: null,
      revision: null,
      loadError: null,
      commandError: null,
      notice: null,
      saving: false,

      async load(id) {
        generation += 1;
        deleted = false;
        const loadGeneration = generation;
        set({
          status: 'loading',
          id,
          doc: null,
          state: null,
          revision: null,
          loadError: null,
          commandError: null,
          notice: null,
        });
        const result = await backend.loadTournament(id);
        if (loadGeneration !== generation) {
          return; // a newer load won
        }
        if (result.ok) {
          const { doc, state, revision } = result.value;
          set({ status: 'ready', doc, state, revision });
        } else {
          set({ status: 'error', loadError: result.error });
        }
      },

      dispatch(cmd) {
        return get().dispatchAll([cmd]);
      },

      dispatchAll(commands) {
        if (deleted) {
          return refused('Tournament no longer exists');
        }
        const { doc } = get();
        if (doc === null) {
          return refused('No tournament is loaded');
        }
        const result = executeAll(doc, commands, deps);
        if (!result.ok) {
          set({ commandError: result.error });
          return result;
        }
        set({ doc: result.value.doc, state: result.value.state, commandError: null });
        enqueue(result.value.doc);
        return ok(result.value.state);
      },

      clearNotice() {
        set({ notice: null });
      },
    };
  });
}

export type TournamentStore = ReturnType<typeof createTournamentStore>;

export const useTournamentStore = createTournamentStore(getStorage());
