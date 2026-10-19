import { describe, expect, it, vi } from 'vitest';
import { createTournament, execute, type Command, type TournamentDocument } from '../domain';
import { CREATED_PAYLOAD, PLAYERS, runningDoc, uuid } from '../domain/fixtures/builders';
import { DexieBackend } from '../storage';
import { createTournamentStore, type TournamentStore } from './tournamentStore';

const [P1, P2, P3] = PLAYERS;

let dbCount = 0;

function freshBackend() {
  dbCount += 1;
  return new DexieBackend({ dbName: `test-tournament-store-${dbCount}` });
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function newDoc(): TournamentDocument {
  return unwrap(createTournament(CREATED_PAYLOAD)).doc;
}

const register = (playerId: string, playerName: string): Command => ({
  type: 'PlayerRegistered',
  payload: { playerId, playerName },
});

/** Saves `doc`, then opens it in a new store. */
async function openStore(doc: TournamentDocument = newDoc()) {
  const backend = freshBackend();
  unwrap(await backend.saveTournament(doc, null));
  const store = createTournamentStore(backend);
  await store.getState().load(doc.id);
  return { backend, store, doc };
}

async function idle(store: TournamentStore) {
  await vi.waitFor(() => expect(store.getState().saving).toBe(false));
}

describe('tournamentStore load', () => {
  it('loads a stored tournament', async () => {
    const { store, doc } = await openStore();
    expect(store.getState()).toMatchObject({
      status: 'ready',
      id: doc.id,
      doc,
      revision: '1',
      loadError: null,
      notice: null,
      saving: false,
    });
    expect(store.getState().state?.name).toBe(CREATED_PAYLOAD.name);
  });

  it('sets loadError for an unknown id', async () => {
    const store = createTournamentStore(freshBackend());
    await store.getState().load(uuid(4242));
    expect(store.getState()).toMatchObject({
      status: 'error',
      doc: null,
      loadError: { code: 'NOT_FOUND' },
    });
  });

  it('refuses a dispatch before anything is loaded', () => {
    const store = createTournamentStore(freshBackend());
    expect(store.getState().dispatch(register(P1, 'Alice'))).toMatchObject({
      ok: false,
      error: { code: 'WRONG_STATUS' },
    });
  });
});

describe('tournamentStore dispatch', () => {
  it('saves three rapid dispatches in order, ending at revision "4" with no notice', async () => {
    const { backend, store, doc } = await openStore();
    const { dispatch } = store.getState();

    expect(dispatch(register(P1, 'Alice')).ok).toBe(true);
    expect(dispatch(register(P2, 'Bruno')).ok).toBe(true);
    expect(dispatch(register(P3, 'Carmen')).ok).toBe(true);
    // Optimistic: the state is updated before any save resolves.
    expect(Object.keys(store.getState().state?.players ?? {})).toEqual([P1, P2, P3]);
    expect(store.getState().saving).toBe(true);

    await idle(store);
    expect(store.getState()).toMatchObject({ revision: '4', notice: null });
    const stored = unwrap(await backend.loadTournament(doc.id));
    expect(stored.revision).toBe('4');
    expect(stored.doc.events).toHaveLength(4);
  });

  it('sets commandError for a rejected command and saves nothing', async () => {
    const { backend, store, doc } = await openStore();

    const result = store.getState().dispatch({ type: 'PlayerDropped', payload: { playerId: P1 } });

    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_PLAYER' } });
    expect(store.getState()).toMatchObject({
      commandError: { code: 'UNKNOWN_PLAYER' },
      saving: false,
      doc,
    });
    expect(unwrap(await backend.loadTournament(doc.id)).revision).toBe('1');

    store.getState().dispatch(register(P1, 'Alice'));
    expect(store.getState().commandError).toBeNull();
    await idle(store);
  });

  it('reloads the other writer’s document and sets a conflict notice on a revision race', async () => {
    const { backend, store, doc } = await openStore();
    const other = unwrap(execute(doc, register(P2, 'Other tab'))).doc;
    unwrap(await backend.saveTournament(other, '1'));

    store.getState().dispatch(register(P1, 'Alice'));
    await idle(store);

    expect(store.getState()).toMatchObject({
      notice: { kind: 'conflict' },
      revision: '2',
      doc: other,
      status: 'ready',
    });
    expect(Object.keys(store.getState().state?.players ?? {})).toEqual([P2]);
    expect(unwrap(await backend.loadTournament(doc.id)).doc).toEqual(other);
  });

  it('drops the rest of the queue after a conflict', async () => {
    const { backend, store, doc } = await openStore();
    const other = unwrap(execute(doc, register(P3, 'Other tab'))).doc;
    unwrap(await backend.saveTournament(other, '1'));
    const save = vi.spyOn(backend, 'saveTournament');

    store.getState().dispatch(register(P1, 'Alice'));
    store.getState().dispatch(register(P2, 'Bruno'));
    await idle(store);

    expect(save).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ notice: { kind: 'conflict' }, revision: '2' });
    expect(unwrap(await backend.loadTournament(doc.id)).revision).toBe('2');
  });

  it('sets a notFound notice when the tournament was deleted and refuses later dispatches', async () => {
    const { backend, store, doc } = await openStore();
    unwrap(await backend.deleteTournament(doc.id, '1'));

    store.getState().dispatch(register(P1, 'Alice'));
    await idle(store);
    expect(store.getState().notice).toEqual({ kind: 'notFound' });

    const before = store.getState().doc;
    expect(store.getState().dispatch(register(P2, 'Bruno'))).toEqual({
      ok: false,
      error: { code: 'WRONG_STATUS', message: 'Tournament no longer exists' },
    });
    expect(store.getState().doc).toBe(before);
    expect(store.getState().saving).toBe(false);

    // load() lifts the block; the tournament is gone, so it reports NOT_FOUND.
    await store.getState().load(doc.id);
    expect(store.getState()).toMatchObject({
      status: 'error',
      loadError: { code: 'NOT_FOUND' },
      notice: null,
    });
  });

  it('reloads and sets a saveFailed notice on any other save error', async () => {
    const { backend, store, doc } = await openStore();
    const error = { code: 'UNAVAILABLE' as const, message: 'Disk full' };
    vi.spyOn(backend, 'saveTournament').mockResolvedValueOnce({ ok: false, error });

    store.getState().dispatch(register(P1, 'Alice'));
    await idle(store);

    expect(store.getState()).toMatchObject({
      notice: { kind: 'saveFailed', error },
      doc,
      revision: '1',
    });
    expect(store.getState().state?.players).toEqual({});
  });

  it('clears the notice', async () => {
    const { backend, store, doc } = await openStore();
    unwrap(await backend.saveTournament(unwrap(execute(doc, register(P2, 'X'))).doc, '1'));
    store.getState().dispatch(register(P1, 'Alice'));
    await idle(store);

    store.getState().clearNotice();
    expect(store.getState().notice).toBeNull();
  });
});

describe('tournamentStore on a running tournament', () => {
  it('accepts a late entry and a drop, and saves both', async () => {
    const { backend, store, doc } = await openStore(runningDoc(4));
    expect(store.getState().state?.status).toBe('running');
    const late = uuid(150);

    expect(store.getState().dispatch(register(late, 'Late')).ok).toBe(true);
    expect(store.getState().dispatch({ type: 'PlayerDropped', payload: { playerId: P1 } }).ok).toBe(
      true,
    );
    await idle(store);

    const { state } = unwrap(await backend.loadTournament(doc.id));
    expect(state.players[late]).toMatchObject({ registeredAtRound: 1, dropped: false });
    expect(state.players[P1].dropped).toBe(true);
    expect(store.getState()).toMatchObject({ revision: '3', notice: null });
  });

  it('rejects PlayerUnregistered with WRONG_STATUS', async () => {
    const { store } = await openStore(runningDoc(4));
    expect(
      store.getState().dispatch({ type: 'PlayerUnregistered', payload: { playerId: P1 } }),
    ).toMatchObject({ ok: false, error: { code: 'WRONG_STATUS' } });
    expect(store.getState().commandError?.code).toBe('WRONG_STATUS');
  });
});

describe('tournamentStore dispatchAll', () => {
  it('appends every command with one save', async () => {
    const { backend, store, doc } = await openStore();
    const save = vi.spyOn(backend, 'saveTournament');

    const result = store
      .getState()
      .dispatchAll([register(P1, 'Alice'), register(P2, 'Bruno'), register(P3, 'Carmen')]);

    expect(result.ok).toBe(true);
    expect(Object.keys(store.getState().state?.players ?? {})).toEqual([P1, P2, P3]);
    await idle(store);
    expect(save).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ revision: '2', notice: null });
    expect(unwrap(await backend.loadTournament(doc.id)).doc.events).toHaveLength(4);
  });

  it('sets commandError for a failing list and changes nothing', async () => {
    const { backend, store, doc } = await openStore();
    const before = store.getState().state;
    const save = vi.spyOn(backend, 'saveTournament');

    const result = store
      .getState()
      .dispatchAll([register(P1, 'Alice'), { type: 'PlayerDropped', payload: { playerId: P2 } }]);

    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_PLAYER' } });
    expect(store.getState()).toMatchObject({
      commandError: { code: 'UNKNOWN_PLAYER' },
      saving: false,
      doc,
    });
    expect(store.getState().state).toBe(before);
    expect(save).not.toHaveBeenCalled();
  });
});
