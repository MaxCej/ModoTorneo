import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTournament,
  execute,
  type TournamentCreatedPayload,
  type TournamentDocument,
} from '../domain';
import { CREATED_PAYLOAD, TOURNAMENT_ID, uuid } from '../domain/fixtures/builders';
import fixture from '../domain/fixtures/top4-8players.json';
import { ModoTorneoDb } from './db';
import { DexieBackend } from './dexieBackend';

const NOW = '2026-10-11T20:00:00.000Z';

let dbCount = 0;

/** A backend on a fresh database, with a fixed clock. */
function freshBackend() {
  dbCount += 1;
  const dbName = `test-dexie-backend-${dbCount}`;
  return { dbName, backend: new DexieBackend({ dbName, now: () => NOW }) };
}

function fixtureDoc(): TournamentDocument {
  return structuredClone(fixture) as TournamentDocument;
}

/** The first `count` events of the fixture: a valid, shorter log of the same tournament. */
function fixturePrefix(count: number): TournamentDocument {
  const doc = fixtureDoc();
  return { ...doc, events: doc.events.slice(0, count) };
}

let idCount = 0;

function newDoc(overrides: Partial<TournamentCreatedPayload>): TournamentDocument {
  const result = createTournament(
    { ...CREATED_PAYLOAD, ...overrides },
    { now: () => NOW, newId: () => uuid(5000 + ++idCount) },
  );
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value.doc;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DexieBackend tournaments', () => {
  it('creates with revision "1" and increments on each save', async () => {
    const { backend } = freshBackend();
    const created = await backend.saveTournament(fixturePrefix(5), null);
    expect(created).toMatchObject({ ok: true, value: { revision: '1' } });

    const updated = await backend.saveTournament(fixtureDoc(), '1');
    expect(updated).toMatchObject({ ok: true, value: { revision: '2' } });

    const loaded = await backend.loadTournament(TOURNAMENT_ID);
    expect(loaded.ok && loaded.value.revision).toBe('2');
    expect(loaded.ok && loaded.value.doc).toEqual(fixture);
    expect(loaded.ok && loaded.value.state.status).toBe('finished');
  });

  it('returns CONFLICT when creating an id that already exists', async () => {
    const { backend } = freshBackend();
    await backend.saveTournament(fixturePrefix(5), null);

    const again = await backend.saveTournament(fixtureDoc(), null);
    expect(again.ok || again.error.code).toBe('CONFLICT');

    const loaded = await backend.loadTournament(TOURNAMENT_ID);
    expect(loaded.ok && loaded.value.doc.events).toHaveLength(5);
  });

  it('returns CONFLICT on a stale revision and leaves the row unchanged', async () => {
    const { backend } = freshBackend();
    await backend.saveTournament(fixturePrefix(5), null);
    await backend.saveTournament(fixturePrefix(6), '1');

    const staleSave = await backend.saveTournament(fixtureDoc(), '1');
    expect(staleSave.ok || staleSave.error.code).toBe('CONFLICT');

    const staleDelete = await backend.deleteTournament(TOURNAMENT_ID, '1');
    expect(staleDelete.ok || staleDelete.error.code).toBe('CONFLICT');

    const loaded = await backend.loadTournament(TOURNAMENT_ID);
    expect(loaded.ok && loaded.value.revision).toBe('2');
    expect(loaded.ok && loaded.value.doc.events).toHaveLength(6);
  });

  it('returns NOT_FOUND when saving an unknown id with a revision', async () => {
    const { backend } = freshBackend();
    const result = await backend.saveTournament(fixtureDoc(), '1');
    expect(result.ok || result.error.code).toBe('NOT_FOUND');

    const list = await backend.listTournaments();
    expect(list.ok && list.value).toEqual([]);
  });

  it('returns NOT_FOUND when loading or deleting an unknown id', async () => {
    const { backend } = freshBackend();
    const loaded = await backend.loadTournament(TOURNAMENT_ID);
    expect(loaded.ok || loaded.error.code).toBe('NOT_FOUND');

    const deleted = await backend.deleteTournament(TOURNAMENT_ID, '1');
    expect(deleted.ok || deleted.error.code).toBe('NOT_FOUND');
  });

  it('returns INVALID_DOCUMENT with the domain error and stores nothing', async () => {
    const { backend } = freshBackend();
    const broken = fixtureDoc();
    broken.events[3] = { ...broken.events[3], seq: 99 };

    const result = await backend.saveTournament(broken, null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_DOCUMENT');
      expect(result.error.cause?.code).toBe('SEQ_GAP');
    }

    const list = await backend.listTournaments();
    expect(list.ok && list.value).toEqual([]);
  });

  it('returns INVALID_DOCUMENT when the stored row was corrupted', async () => {
    const { dbName, backend } = freshBackend();
    await backend.saveTournament(fixtureDoc(), null);

    const raw = new ModoTorneoDb(dbName);
    await raw.tournaments.toCollection().modify((row) => {
      (row.doc as { schemaVersion: unknown }).schemaVersion = 7;
    });
    raw.close();

    const loaded = await backend.loadTournament(TOURNAMENT_ID);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error.code).toBe('INVALID_DOCUMENT');
      expect(loaded.error.cause?.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
    }
  });

  it('lists the fixture summary recomputed from its log', async () => {
    const { backend } = freshBackend();
    await backend.saveTournament(fixtureDoc(), null);

    const list = await backend.listTournaments();
    expect(list).toEqual({
      ok: true,
      value: [
        {
          id: TOURNAMENT_ID,
          name: 'Friday Night Magic',
          date: '2026-10-11',
          format: 'modern',
          status: 'finished',
          eventCount: fixture.events.length,
          updatedAt: NOW,
          revision: '1',
        },
      ],
    });
  });

  it('reflects TournamentDetailsChanged in the summary after save', async () => {
    const { backend } = freshBackend();
    const doc = newDoc({ name: 'Before', date: '2026-10-01', format: 'modern' });
    const created = await backend.saveTournament(doc, null);
    if (!created.ok) {
      throw new Error('expected ok');
    }
    const changed = execute(doc, {
      type: 'TournamentDetailsChanged',
      payload: { name: 'After', date: '2026-10-02', format: 'legacy' },
    });
    if (!changed.ok) {
      throw new Error(`expected ok, got ${JSON.stringify(changed.error)}`);
    }
    await backend.saveTournament(changed.value.doc, created.value.revision);

    const list = await backend.listTournaments();
    expect(list).toMatchObject({
      ok: true,
      value: [{ id: doc.id, name: 'After', date: '2026-10-02', format: 'legacy', revision: '2' }],
    });
  });

  it('orders the list by date descending, then name ascending', async () => {
    const { backend } = freshBackend();
    const docs = [
      newDoc({ name: 'Bravo', date: '2026-10-01' }),
      newDoc({ name: 'Charlie', date: '2026-10-11' }),
      newDoc({ name: 'Alpha', date: '2026-10-01' }),
      newDoc({ name: 'Alpha', date: '2026-10-11' }),
    ];
    for (const doc of docs) {
      await backend.saveTournament(doc, null);
    }

    const list = await backend.listTournaments();
    expect(list.ok && list.value.map((s) => `${s.date} ${s.name}`)).toEqual([
      '2026-10-11 Alpha',
      '2026-10-11 Charlie',
      '2026-10-01 Alpha',
      '2026-10-01 Bravo',
    ]);
  });

  it('orders tournaments with the same date and name by id', async () => {
    const { backend } = freshBackend();
    const first = newDoc({ name: 'Weekly' });
    const second = newDoc({ name: 'Weekly' });
    await backend.saveTournament(second, null);
    await backend.saveTournament(first, null);

    const list = await backend.listTournaments();
    expect(list.ok && list.value.map((s) => s.id)).toEqual([first.id, second.id]);
  });

  it('deletes with the current revision', async () => {
    const { backend } = freshBackend();
    await backend.saveTournament(fixtureDoc(), null);

    const deleted = await backend.deleteTournament(TOURNAMENT_ID, '1');
    expect(deleted).toEqual({ ok: true, value: undefined });

    const loaded = await backend.loadTournament(TOURNAMENT_ID);
    expect(loaded.ok || loaded.error.code).toBe('NOT_FOUND');
  });

  it('returns UNAVAILABLE when IndexedDB cannot be opened', async () => {
    vi.spyOn(Dexie.dependencies.indexedDB!, 'open').mockImplementation(() => {
      throw new Error('IndexedDB is blocked');
    });
    const { backend } = freshBackend();

    const list = await backend.listTournaments();
    expect(list.ok || list.error.code).toBe('UNAVAILABLE');

    const saved = await backend.saveTournament(fixtureDoc(), null);
    expect(saved.ok || saved.error.code).toBe('UNAVAILABLE');

    const players = await backend.listPlayers();
    expect(players.ok || players.error.code).toBe('UNAVAILABLE');
  });
});

describe('DexieBackend players', () => {
  const CREATED_AT = '2026-10-11T18:00:00.000Z';

  it('inserts a player and lists it', async () => {
    const { backend } = freshBackend();
    const alice = { id: uuid(101), name: 'Alice', createdAt: CREATED_AT };

    const saved = await backend.savePlayer(alice);
    expect(saved).toEqual({ ok: true, value: undefined });

    const list = await backend.listPlayers();
    expect(list).toEqual({ ok: true, value: [alice] });
  });

  it('updates an existing player by id', async () => {
    const { backend } = freshBackend();
    await backend.savePlayer({ id: uuid(101), name: 'Alice', createdAt: CREATED_AT });
    await backend.savePlayer({ id: uuid(101), name: 'Alicia', createdAt: CREATED_AT });

    const list = await backend.listPlayers();
    expect(list).toEqual({
      ok: true,
      value: [{ id: uuid(101), name: 'Alicia', createdAt: CREATED_AT }],
    });
  });

  it('lists players by name ascending', async () => {
    const { backend } = freshBackend();
    for (const [n, name] of [
      [1, 'Diego'],
      [2, 'alice'],
      [3, 'Bruno'],
      [4, 'Carmen'],
    ] as const) {
      await backend.savePlayer({ id: uuid(100 + n), name, createdAt: CREATED_AT });
    }

    const list = await backend.listPlayers();
    expect(list.ok && list.value.map((p) => p.name)).toEqual(['alice', 'Bruno', 'Carmen', 'Diego']);
  });

  it('stores the parsed player, with the name trimmed', async () => {
    const { backend } = freshBackend();
    await backend.savePlayer({ id: uuid(101), name: '  Alice ', createdAt: CREATED_AT });

    const list = await backend.listPlayers();
    expect(list).toEqual({
      ok: true,
      value: [{ id: uuid(101), name: 'Alice', createdAt: CREATED_AT }],
    });
  });

  it.each([
    ['a whitespace-only name', { id: uuid(101), name: '   ', createdAt: CREATED_AT }],
    ['an invalid id', { id: 'alice', name: 'Alice', createdAt: CREATED_AT }],
    ['a name over 100 characters', { id: uuid(101), name: 'a'.repeat(101), createdAt: CREATED_AT }],
  ])('returns INVALID_PLAYER for %s and stores nothing', async (_, player) => {
    const { backend } = freshBackend();

    const saved = await backend.savePlayer(player);
    expect(saved.ok).toBe(false);
    if (!saved.ok) {
      expect(saved.error.code).toBe('INVALID_PLAYER');
      expect(saved.error.cause?.code).toBe('INVALID_SCHEMA');
    }
    expect(await backend.listPlayers()).toEqual({ ok: true, value: [] });
  });

  it('returns INVALID_PLAYER from listPlayers when a stored row was corrupted', async () => {
    const { dbName, backend } = freshBackend();
    await backend.savePlayer({ id: uuid(101), name: 'Alice', createdAt: CREATED_AT });
    await backend.savePlayer({ id: uuid(102), name: 'Bruno', createdAt: CREATED_AT });

    const raw = new ModoTorneoDb(dbName);
    await raw.players.update(uuid(102), { name: '' });
    raw.close();

    const list = await backend.listPlayers();
    expect(list.ok).toBe(false);
    if (!list.ok) {
      expect(list.error.code).toBe('INVALID_PLAYER');
      expect(list.error.cause?.code).toBe('INVALID_SCHEMA');
    }
  });

  it('orders players with the same name by id', async () => {
    const { backend } = freshBackend();
    await backend.savePlayer({ id: uuid(102), name: 'Alex', createdAt: CREATED_AT });
    await backend.savePlayer({ id: uuid(101), name: 'Alex', createdAt: CREATED_AT });

    const list = await backend.listPlayers();
    expect(list.ok && list.value.map((p) => p.id)).toEqual([uuid(101), uuid(102)]);
  });
});
