import { create } from 'zustand';
import { err, newId, ok, type IsoDateTime, type Player, type Result, type Uuid } from '../domain';
import { getStorage, type StorageBackend, type StorageError } from '../storage';

export type PlayersStoreState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  players: Player[]; // name asc
  error: StorageError | null;
  load(): Promise<void>;
  addPlayer(name: string): Promise<Result<Player, StorageError>>; // new id, createdAt = now
  /** Saves the player with the new name (same id and createdAt). NOT_FOUND when the id is not loaded. */
  renamePlayer(id: Uuid, name: string): Promise<Result<Player, StorageError>>;
};

export type PlayersStoreDeps = { now: () => IsoDateTime; newId: () => Uuid };

const defaultDeps: PlayersStoreDeps = { now: () => new Date().toISOString(), newId };

/** Same order as `listPlayers`: English collation, then id. */
const collator = new Intl.Collator('en');
function byName(a: Player, b: Player): number {
  return collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The global player registry. Tests inject the backend; the app uses `usePlayersStore`. */
export function createPlayersStore(backend: StorageBackend, deps: PlayersStoreDeps = defaultDeps) {
  return create<PlayersStoreState>()((set, get) => ({
    status: 'idle',
    players: [],
    error: null,

    async load() {
      set({ status: 'loading', error: null });
      const result = await backend.listPlayers();
      if (result.ok) {
        set({ status: 'ready', players: result.value });
      } else {
        set({ status: 'error', error: result.error });
      }
    },

    async addPlayer(name) {
      const player: Player = { id: deps.newId(), name, createdAt: deps.now() };
      const saved = await backend.savePlayer(player);
      if (!saved.ok) {
        return err(saved.error);
      }
      // savePlayer stores the parsed player; mirror its trimmed name.
      const stored = { ...player, name: name.trim() };
      set((state) => ({ players: [...state.players, stored].sort(byName) }));
      return ok(stored);
    },

    async renamePlayer(id, name) {
      const current = get().players.find((player) => player.id === id);
      if (current === undefined) {
        return err({ code: 'NOT_FOUND', message: `No player with id ${id}` });
      }
      const saved = await backend.savePlayer({ ...current, name });
      if (!saved.ok) {
        return err(saved.error);
      }
      const stored = { ...current, name: name.trim() };
      set((state) => ({
        players: state.players.map((player) => (player.id === id ? stored : player)).sort(byName),
      }));
      return ok(stored);
    },
  }));
}

export type PlayersStore = ReturnType<typeof createPlayersStore>;

export const usePlayersStore = createPlayersStore(getStorage());
