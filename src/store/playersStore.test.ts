import { describe, expect, it } from 'vitest';
import { uuid } from '../domain/fixtures/builders';
import { DexieBackend } from '../storage';
import { createPlayersStore } from './playersStore';

const NOW = '2026-10-11T18:00:00.000Z';

let dbCount = 0;

function setup() {
  dbCount += 1;
  const backend = new DexieBackend({ dbName: `test-players-store-${dbCount}` });
  let n = 500;
  const store = createPlayersStore(backend, { now: () => NOW, newId: () => uuid(++n) });
  return { backend, store };
}

describe('playersStore', () => {
  it('loads the registry by name ascending', async () => {
    const { backend, store } = setup();
    await backend.savePlayer({ id: uuid(2), name: 'Bruno', createdAt: NOW });
    await backend.savePlayer({ id: uuid(1), name: 'alice', createdAt: NOW });

    await store.getState().load();

    expect(store.getState()).toMatchObject({ status: 'ready', error: null });
    expect(store.getState().players.map((p) => p.name)).toEqual(['alice', 'Bruno']);
  });

  it('adds a player with a new id and createdAt, trimmed, in name order', async () => {
    const { backend, store } = setup();
    await backend.savePlayer({ id: uuid(1), name: 'Carmen', createdAt: NOW });
    await store.getState().load();

    const result = await store.getState().addPlayer('  Alice ');

    expect(result).toEqual({ ok: true, value: { id: uuid(501), name: 'Alice', createdAt: NOW } });
    expect(store.getState().players.map((p) => p.name)).toEqual(['Alice', 'Carmen']);
    expect(await backend.listPlayers()).toEqual({
      ok: true,
      value: store.getState().players,
    });
  });

  it('returns INVALID_PLAYER for a blank name and changes nothing', async () => {
    const { backend, store } = setup();
    await store.getState().load();

    const result = await store.getState().addPlayer('   ');

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_PLAYER' } });
    expect(store.getState().players).toEqual([]);
    expect(await backend.listPlayers()).toEqual({ ok: true, value: [] });
  });

  it('sets error when the registry cannot be listed', async () => {
    const { backend, store } = setup();
    const error = { code: 'UNAVAILABLE' as const, message: 'blocked' };
    backend.listPlayers = async () => ({ ok: false, error });

    await store.getState().load();

    expect(store.getState()).toMatchObject({ status: 'error', error });
  });
});
