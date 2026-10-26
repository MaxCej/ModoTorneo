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

  it('renames a player with the same id and createdAt, trimmed, in name order', async () => {
    const { backend, store } = setup();
    await backend.savePlayer({ id: uuid(1), name: 'Alice', createdAt: NOW });
    await backend.savePlayer({ id: uuid(2), name: 'Bruno', createdAt: '2026-01-01T00:00:00.000Z' });
    await store.getState().load();

    const result = await store.getState().renamePlayer(uuid(2), '  Aaron ');

    const renamed = { id: uuid(2), name: 'Aaron', createdAt: '2026-01-01T00:00:00.000Z' };
    expect(result).toEqual({ ok: true, value: renamed });
    expect(store.getState().players.map((p) => p.name)).toEqual(['Aaron', 'Alice']);
    expect(await backend.listPlayers()).toEqual({ ok: true, value: store.getState().players });
  });

  it('returns the storage error on a failed rename and changes nothing', async () => {
    const { backend, store } = setup();
    await backend.savePlayer({ id: uuid(1), name: 'Alice', createdAt: NOW });
    await store.getState().load();
    const before = store.getState().players;
    const error = { code: 'UNAVAILABLE' as const, message: 'offline' };
    backend.savePlayer = async () => ({ ok: false, error });

    const result = await store.getState().renamePlayer(uuid(1), 'Zoe');

    expect(result).toEqual({ ok: false, error });
    expect(store.getState().players).toBe(before);
  });

  it('returns NOT_FOUND for an unknown id without saving', async () => {
    const { backend, store } = setup();
    await store.getState().load();
    let saves = 0;
    backend.savePlayer = async () => {
      saves += 1;
      return { ok: true, value: undefined };
    };

    const result = await store.getState().renamePlayer(uuid(9), 'Zoe');

    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(saves).toBe(0);
  });
});
