import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTournament,
  execute,
  playerResults,
  reduce,
  tournamentMetagame,
  type Command,
  type PlayerResult,
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
          playerCount: 8, // 8 registered, the dropped player included
          updatedAt: NOW,
          revision: '1',
          players: playerResults(
            reduce(fixture.events as TournamentDocument['events'], TOURNAMENT_ID),
          ),
          archetypes: [],
          metagame: fixtureMetagame(),
        },
      ],
    });
  });

  it('counts registered players in the summary, not unregistered ones', async () => {
    const { backend } = freshBackend();
    let doc = newDoc({ name: 'Counted' });
    for (const command of [
      { type: 'PlayerRegistered', payload: { playerId: uuid(101), playerName: 'Alice' } },
      { type: 'PlayerRegistered', payload: { playerId: uuid(102), playerName: 'Bruno' } },
      { type: 'PlayerRegistered', payload: { playerId: uuid(103), playerName: 'Carmen' } },
      { type: 'PlayerDropped', payload: { playerId: uuid(102) } },
      { type: 'PlayerUnregistered', payload: { playerId: uuid(103) } },
    ] as const) {
      const result = execute(doc, command);
      if (!result.ok) {
        throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
      }
      doc = result.value.doc;
    }

    const saved = await backend.saveTournament(doc, null);
    expect(saved.ok && saved.value.summary.playerCount).toBe(2);
    const list = await backend.listTournaments();
    expect(list.ok && list.value[0].playerCount).toBe(2);
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

const fixturePlayers = () => playerResults(reduce(fixtureDoc().events, TOURNAMENT_ID));
const fixtureMetagame = () => tournamentMetagame(reduce(fixtureDoc().events, TOURNAMENT_ID));

/** The fixture plus a `DeckSet` with an archetype for each of its first two players. */
function fixtureWithDecks(): TournamentDocument {
  const doc = fixtureDoc();
  const [first, second] = Object.keys(reduce(doc.events, TOURNAMENT_ID).players);
  const at = doc.events.at(-1)!.at;
  const deckSet = (seq: number, playerId: string, archetype: string) => ({
    id: uuid(7000 + seq),
    seq,
    at,
    type: 'DeckSet' as const,
    payload: { playerId, archetype, main: [], sideboard: [] },
  });
  const next = doc.events.length + 1;
  return {
    ...doc,
    events: [
      ...doc.events,
      deckSet(next, first, 'Burn'),
      deckSet(next + 1, second, 'Amulet Titan'),
    ],
  };
}

describe('DexieBackend decks', () => {
  it('returns archetypes and metagame (guests included) and archetype per registry player', async () => {
    const { backend } = freshBackend();
    let doc = newDoc({ name: 'Decks' });
    for (const command of [
      { type: 'PlayerRegistered', payload: { playerId: uuid(101), playerName: 'Alice' } },
      {
        type: 'PlayerRegistered',
        payload: { playerId: uuid(102), playerName: 'Guest', guest: true },
      },
      { type: 'PlayerRegistered', payload: { playerId: uuid(103), playerName: 'Carmen' } },
      {
        type: 'SetDeck',
        payload: { playerId: uuid(101), archetype: 'Burn', main: [], sideboard: [] },
      },
      {
        type: 'SetDeck',
        payload: { playerId: uuid(102), archetype: 'Elves', main: [], sideboard: [] },
      },
    ] satisfies Command[]) {
      const result = execute(doc, command);
      if (!result.ok) {
        throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
      }
      doc = result.value.doc;
    }

    const saved = await backend.saveTournament(doc, null);
    expect(saved.ok && saved.value.summary.archetypes).toEqual(['Burn', 'Elves']);
    const list = await backend.listTournaments();
    expect(list.ok && list.value[0].archetypes).toEqual(['Burn', 'Elves']);
    expect(list.ok && list.value[0].players.map((p) => [p.playerName, p.archetype])).toEqual([
      ['Alice', 'Burn'],
      ['Carmen', null],
    ]);
    expect(list.ok && list.value[0].metagame.archetypes).toEqual([
      { archetype: 'Burn', players: 1, topCut: 0 },
      { archetype: 'Elves', players: 1, topCut: 0 },
      { archetype: null, players: 1, topCut: 0 },
    ]);
  });
});

describe('DexieBackend version 6 upgrade', () => {
  /** A version 5 database (SPEC 11 schema) with rows that have no `metagame`. */
  async function seedVersion5(dbName: string, row: Record<string, unknown>) {
    const v5 = new Dexie(dbName);
    v5.version(5).stores({
      tournaments: 'id, date, format, status, updatedAt',
      players: 'id, name',
      githubSummaries: '[repo+id]',
    });
    await v5.table('tournaments').add(row);
    await v5.table('githubSummaries').add({
      repo: 'owner/data',
      id: TOURNAMENT_ID,
      sha: 'abc',
      summary: { id: TOURNAMENT_ID },
    });
    v5.close();
  }

  const v5Row = (doc: TournamentDocument) => ({
    id: doc.id,
    doc,
    revision: 3,
    name: 'Friday Night Magic',
    date: '2026-10-11',
    format: 'modern',
    status: 'finished',
    eventCount: doc.events.length,
    playerCount: 8,
    updatedAt: NOW,
    players: fixturePlayers(),
    archetypes: ['Amulet Titan', 'Burn'],
  });

  it('opens a version 5 database at version 6 with metagame filled and an empty cache', async () => {
    const { dbName, backend } = freshBackend();
    const doc = fixtureWithDecks();
    const metagame = tournamentMetagame(reduce(doc.events, TOURNAMENT_ID));
    await seedVersion5(dbName, v5Row(doc));

    const raw = new ModoTorneoDb(dbName);
    await raw.open();
    expect(raw.verno).toBe(6);
    expect(await raw.tournaments.get(TOURNAMENT_ID)).toEqual({ ...v5Row(doc), metagame });
    expect(metagame.archetypes.map((a) => [a.archetype, a.players])).toEqual([
      ['Amulet Titan', 1],
      ['Burn', 1],
      [null, 6],
    ]);
    expect(await raw.githubSummaries.count()).toBe(0);
    raw.close();

    const list = await backend.listTournaments();
    expect(list.ok && list.value[0].metagame).toEqual(metagame);
  });

  it('gives an invalid stored doc an empty metagame, and it still fails on load', async () => {
    const { dbName, backend } = freshBackend();
    const broken = { ...fixtureDoc(), schemaVersion: 7 } as unknown as TournamentDocument;
    await seedVersion5(dbName, v5Row(broken));

    const list = await backend.listTournaments();
    expect(list.ok && list.value[0].metagame).toEqual({ archetypes: [], matchups: [] });
    const loaded = await backend.loadTournament(TOURNAMENT_ID);
    expect(loaded.ok || loaded.error.code).toBe('INVALID_DOCUMENT');
  });
});

describe('DexieBackend version 5 upgrade', () => {
  /** A version 4 database (SPEC 10 schema) with rows that have no `archetypes`. */
  async function seedVersion4(dbName: string, row: Record<string, unknown>) {
    const v4 = new Dexie(dbName);
    v4.version(4).stores({
      tournaments: 'id, date, format, status, updatedAt',
      players: 'id, name',
      githubSummaries: '[repo+id]',
    });
    await v4.table('tournaments').add(row);
    await v4.table('githubSummaries').add({
      repo: 'owner/data',
      id: TOURNAMENT_ID,
      sha: 'abc',
      summary: { id: TOURNAMENT_ID },
    });
    v4.close();
  }

  const v4Row = (doc: TournamentDocument) => ({
    id: doc.id,
    doc,
    revision: 3,
    name: 'Friday Night Magic',
    date: '2026-10-11',
    format: 'modern',
    status: 'finished',
    eventCount: doc.events.length,
    playerCount: 8,
    updatedAt: NOW,
    // Version 4 rows have no `archetype` on their player results.
    players: fixturePlayers().map((player) => {
      const rest: Partial<PlayerResult> = { ...player };
      delete rest.archetype;
      return rest;
    }),
  });

  it('opens a version 4 database at version 6 with archetypes filled and an empty cache', async () => {
    const { dbName, backend } = freshBackend();
    const doc = fixtureWithDecks();
    const state = reduce(doc.events, TOURNAMENT_ID);
    const players = playerResults(state);
    await seedVersion4(dbName, v4Row(doc));

    const raw = new ModoTorneoDb(dbName);
    await raw.open();
    // Version 6 (SPEC 12) runs after the version 5 upgrade.
    expect(raw.verno).toBe(6);
    expect(await raw.tournaments.get(TOURNAMENT_ID)).toEqual({
      ...v4Row(doc),
      players,
      archetypes: ['Amulet Titan', 'Burn'],
      metagame: tournamentMetagame(state),
    });
    expect(players.filter((p) => p.archetype !== null)).toHaveLength(2);
    expect(await raw.githubSummaries.count()).toBe(0);
    raw.close();

    const list = await backend.listTournaments();
    expect(list.ok && list.value[0].archetypes).toEqual(['Amulet Titan', 'Burn']);
  });

  it('gives an invalid stored doc archetypes [], and it still fails on load', async () => {
    const { dbName, backend } = freshBackend();
    const broken = { ...fixtureDoc(), schemaVersion: 7 } as unknown as TournamentDocument;
    await seedVersion4(dbName, v4Row(broken));

    const list = await backend.listTournaments();
    expect(list.ok && list.value[0]).toMatchObject({ archetypes: [], players: [] });
    const loaded = await backend.loadTournament(TOURNAMENT_ID);
    expect(loaded.ok || loaded.error.code).toBe('INVALID_DOCUMENT');
  });
});

describe('DexieBackend version 4 upgrade', () => {
  const v3Row = (doc: TournamentDocument) => ({
    id: doc.id,
    doc,
    revision: 3,
    name: 'Friday Night Magic',
    date: '2026-10-11',
    format: 'modern',
    status: 'finished',
    eventCount: doc.events.length,
    playerCount: 8,
    updatedAt: NOW,
  });

  /** A version 3 database (SPEC 09 schema) with rows that have no `players`. */
  async function seedVersion3(dbName: string, row: Record<string, unknown>) {
    const v3 = new Dexie(dbName);
    v3.version(3).stores({
      tournaments: 'id, date, format, status, updatedAt',
      players: 'id, name',
      githubSummaries: '[repo+id]',
    });
    await v3.table('tournaments').add(row);
    await v3.table('githubSummaries').add({
      repo: 'owner/data',
      id: TOURNAMENT_ID,
      sha: 'abc',
      summary: { id: TOURNAMENT_ID },
    });
    v3.close();
  }

  it('opens a version 3 database with players computed and an empty cache', async () => {
    const { dbName, backend } = freshBackend();
    const row = v3Row(fixtureDoc());
    await seedVersion3(dbName, row);

    const raw = new ModoTorneoDb(dbName);
    await raw.open();
    expect(raw.verno).toBe(6);
    expect(await raw.tournaments.get(TOURNAMENT_ID)).toEqual({
      ...row,
      players: fixturePlayers(),
      archetypes: [],
      metagame: fixtureMetagame(),
    });
    expect(await raw.githubSummaries.count()).toBe(0);
    raw.close();

    const list = await backend.listTournaments();
    expect(list.ok && list.value[0].players).toEqual(fixturePlayers());
  });

  it('gives an invalid stored doc players [], and it still fails on load', async () => {
    const { dbName, backend } = freshBackend();
    const broken = { ...fixtureDoc(), schemaVersion: 7 } as unknown as TournamentDocument;
    await seedVersion3(dbName, v3Row(broken));

    const list = await backend.listTournaments();
    expect(list.ok && list.value[0].players).toEqual([]);
    const loaded = await backend.loadTournament(TOURNAMENT_ID);
    expect(loaded.ok || loaded.error.code).toBe('INVALID_DOCUMENT');
  });
});

describe('DexieBackend version 3 upgrade', () => {
  it('opens a version 2 database with an empty cache', async () => {
    const { dbName } = freshBackend();
    const doc = fixtureDoc();
    const row = {
      id: doc.id,
      doc,
      revision: 3,
      name: 'Friday Night Magic',
      date: '2026-10-11',
      format: 'modern',
      status: 'finished',
      eventCount: doc.events.length,
      playerCount: 8,
      updatedAt: NOW,
    };
    const v2 = new Dexie(dbName);
    v2.version(2).stores({
      tournaments: 'id, date, format, status, updatedAt',
      players: 'id, name',
    });
    await v2.table('tournaments').add(row);
    v2.close();

    const raw = new ModoTorneoDb(dbName);
    await raw.open();
    // Versions 4 (SPEC 10), 5 (SPEC 11) and 6 (SPEC 12) run after version 3 and add
    // `players`, `archetypes` and `metagame`.
    expect(raw.verno).toBe(6);
    expect(await raw.tournaments.get(TOURNAMENT_ID)).toEqual({
      ...row,
      players: fixturePlayers(),
      archetypes: [],
      metagame: fixtureMetagame(),
    });
    expect(await raw.githubSummaries.count()).toBe(0);
    raw.close();
  });
});

describe('DexieBackend version 2 upgrade', () => {
  /** A version 1 database (SPEC 03 schema) with rows that have no `playerCount`. */
  async function seedVersion1(dbName: string, rows: Array<Record<string, unknown>>) {
    const v1 = new Dexie(dbName);
    v1.version(1).stores({
      tournaments: 'id, date, format, status, updatedAt',
      players: 'id, name',
    });
    await v1.table('tournaments').bulkAdd(rows);
    v1.close();
  }

  const v1Row = (doc: TournamentDocument, name: string) => ({
    id: doc.id,
    doc,
    revision: 3,
    name,
    date: '2026-10-11',
    format: 'modern',
    status: 'finished',
    eventCount: doc.events.length,
    updatedAt: NOW,
  });

  it('opens a version 1 database at version 2 with playerCount computed', async () => {
    const { dbName, backend } = freshBackend();
    await seedVersion1(dbName, [v1Row(fixtureDoc(), 'Friday Night Magic')]);

    const list = await backend.listTournaments();
    expect(list).toMatchObject({
      ok: true,
      value: [{ id: TOURNAMENT_ID, playerCount: 8, revision: '3' }],
    });

    const raw = new ModoTorneoDb(dbName);
    await raw.open();
    // Versions 3 (SPEC 09), 4 (SPEC 10), 5 (SPEC 11) and 6 (SPEC 12) run after the version 2
    // upgrade.
    expect(raw.verno).toBe(6);
    expect((await raw.tournaments.get(TOURNAMENT_ID))?.playerCount).toBe(8);
    raw.close();
  });

  it('gives an invalid stored doc playerCount 0, and it still fails on load', async () => {
    const { dbName, backend } = freshBackend();
    const broken = { ...fixtureDoc(), schemaVersion: 7 } as unknown as TournamentDocument;
    await seedVersion1(dbName, [v1Row(broken, 'Broken')]);

    const list = await backend.listTournaments();
    expect(list.ok && list.value[0].playerCount).toBe(0);
    const loaded = await backend.loadTournament(TOURNAMENT_ID);
    expect(loaded.ok || loaded.error.code).toBe('INVALID_DOCUMENT');
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
