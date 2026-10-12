import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTournament,
  parseImportFile,
  type ParsedImport,
  type TournamentDocument,
} from '../domain';
import { CREATED_PAYLOAD, PLAYERS, TOURNAMENT_ID, uuid } from '../domain/fixtures/builders';
import fixture from '../domain/fixtures/top4-8players.json';
import { DexieBackend } from './dexieBackend';
import { buildDataset } from './exportData';
import { applyImport, planImport, readImportFile, type ConflictChoice } from './importData';

const NOW = '2026-10-11T20:00:00.000Z';
const COPY_ID = uuid(8888);
const [P1] = PLAYERS;
const NAMES = ['Alice', 'Bruno', 'Carmen', 'Diego', 'Elena', 'Fabio', 'Gala', 'Hugo'];

let dbCount = 0;

afterEach(() => {
  vi.restoreAllMocks();
});

function freshBackend() {
  dbCount += 1;
  return new DexieBackend({ dbName: `test-import-data-${dbCount}`, now: () => NOW });
}

function fixtureDoc(): TournamentDocument {
  return structuredClone(fixture) as TournamentDocument;
}

/** The first `count` events of the fixture: a valid, shorter log of the same tournament. */
function fixturePrefix(count: number): TournamentDocument {
  const doc = fixtureDoc();
  return { ...doc, events: doc.events.slice(0, count) };
}

/** The fixture with one event's `at` changed: same length, different log. */
function divergedFixture(): TournamentDocument {
  const doc = fixtureDoc();
  doc.events[20] = { ...doc.events[20], at: '2026-10-12T09:00:00.000Z' };
  return doc;
}

/** A second valid tournament, with no players. */
function otherTournament(): TournamentDocument {
  const result = createTournament(
    { ...CREATED_PAYLOAD, name: 'Saturday Modern' },
    { now: () => NOW, newId: () => uuid(9000) },
  );
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value.doc;
}

function parse(json: unknown): ParsedImport {
  const result = parseImportFile(json);
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function dataset(tournaments: TournamentDocument[], players = [] as unknown[]) {
  return { kind: 'modotorneo-dataset', schemaVersion: 1, exportedAt: NOW, players, tournaments };
}

/** Parses, plans and applies one import, as the Data page does. */
async function importJson(
  backend: DexieBackend,
  json: unknown,
  choices: Record<string, ConflictChoice> = {},
) {
  const plan = await planImport(backend, parse(json));
  if (!plan.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(plan.error)}`);
  }
  return applyImport(backend, plan.value, choices, { newId: () => COPY_ID });
}

async function storedEvents(backend: DexieBackend, id = TOURNAMENT_ID) {
  const loaded = await backend.loadTournament(id);
  return loaded.ok ? loaded.value.doc.events : null;
}

async function playerNames(backend: DexieBackend) {
  const players = await backend.listPlayers();
  return players.ok ? players.value.map((p) => p.name) : null;
}

describe('readImportFile', () => {
  it('returns INVALID_SCHEMA for text that is not JSON', async () => {
    const result = await readImportFile(new File(['{ not json'], 'broken.json'));
    expect(result.ok || result.error.code).toBe('INVALID_SCHEMA');
  });

  it('parses a valid tournament file', async () => {
    const file = new File([JSON.stringify(fixture)], 'fixture.json');
    const result = await readImportFile(file);
    expect(result.ok && result.value.kind).toBe('tournament');
  });

  it('returns the domain error of an invalid document', async () => {
    const file = new File([JSON.stringify({ ...fixture, schemaVersion: 3 })], 'newer.json');
    const result = await readImportFile(file);
    expect(result.ok || result.error.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });
});

describe('planImport', () => {
  it('classifies each outcome against local data', async () => {
    const backend = freshBackend();
    await backend.saveTournament(fixtureDoc(), null);

    const cases: Array<[TournamentDocument, string]> = [
      [otherTournament(), 'new'],
      [fixtureDoc(), 'unchanged'],
      [fixturePrefix(10), 'olderThanLocal'],
      [divergedFixture(), 'conflict'],
    ];
    for (const [doc, outcome] of cases) {
      const plan = await planImport(backend, parse(doc));
      expect(plan.ok && plan.value.items.map((item) => item.outcome)).toEqual([outcome]);
    }

    const ahead = freshBackend();
    await ahead.saveTournament(fixturePrefix(10), null);
    const plan = await planImport(ahead, parse(fixtureDoc()));
    expect(plan.ok && plan.value.items[0]).toMatchObject({
      outcome: 'fastForward',
      local: { id: TOURNAMENT_ID, revision: '1', eventCount: 10 },
    });
  });

  it('lists candidate players minus stored ones, dataset players first', async () => {
    const backend = freshBackend();
    await backend.savePlayer({ id: P1, name: 'Alicia', createdAt: NOW });
    const extra = { id: uuid(200), name: 'Zoe', createdAt: NOW };

    const plan = await planImport(backend, parse(dataset([fixtureDoc()], [extra])));
    expect(plan.ok && plan.value.datasetPlayers).toEqual([extra]);
    expect(plan.ok && plan.value.playersToAdd.map((p) => p.name)).toEqual([
      'Zoe',
      ...NAMES.slice(1),
    ]);
  });
});

describe('applyImport', () => {
  it('adds a prefix, then fast-forwards to the full fixture', async () => {
    const backend = freshBackend();
    expect(await importJson(backend, fixturePrefix(10))).toMatchObject({ added: 1 });
    expect(await importJson(backend, fixtureDoc())).toMatchObject({ added: 0, updated: 1 });
    expect(await storedEvents(backend)).toEqual(fixture.events);
  });

  it('does not apply an older prefix over newer local work', async () => {
    const backend = freshBackend();
    await importJson(backend, fixtureDoc());
    const summary = await importJson(backend, fixturePrefix(10));
    expect(summary).toMatchObject({ olderThanLocal: 1, updated: 0, overwritten: 0 });
    expect(await storedEvents(backend)).toEqual(fixture.events);
  });

  it('counts an identical log as unchanged', async () => {
    const backend = freshBackend();
    await importJson(backend, fixtureDoc());
    expect(await importJson(backend, fixtureDoc())).toMatchObject({ unchanged: 1, updated: 0 });
  });

  it('skips a conflict when the choice is skip or missing', async () => {
    const backend = freshBackend();
    await importJson(backend, fixtureDoc());

    expect(await importJson(backend, divergedFixture(), { [TOURNAMENT_ID]: 'skip' })).toMatchObject(
      { skipped: 1 },
    );
    expect(await importJson(backend, divergedFixture())).toMatchObject({ skipped: 1 });
    expect(await storedEvents(backend)).toEqual(fixture.events);
  });

  it('overwrites the stored events on overwrite', async () => {
    const backend = freshBackend();
    await importJson(backend, fixtureDoc());

    const summary = await importJson(backend, divergedFixture(), { [TOURNAMENT_ID]: 'overwrite' });
    expect(summary).toMatchObject({ overwritten: 1 });
    expect(await storedEvents(backend)).toEqual(divergedFixture().events);
  });

  it('stores a copy with a new id and identical events on copy', async () => {
    const backend = freshBackend();
    await importJson(backend, fixtureDoc());

    const summary = await importJson(backend, divergedFixture(), { [TOURNAMENT_ID]: 'copy' });
    expect(summary).toMatchObject({ copied: 1 });
    expect(await storedEvents(backend)).toEqual(fixture.events);
    expect(await storedEvents(backend, COPY_ID)).toEqual(divergedFixture().events);

    const list = await backend.listTournaments();
    expect(list.ok && list.value.map((s) => s.id).sort()).toEqual([COPY_ID, TOURNAMENT_ID].sort());
  });

  it('adds one global player per registered player, with the snapshot name', async () => {
    const backend = freshBackend();
    const summary = await importJson(backend, fixtureDoc());
    expect(summary.playersAdded).toBe(8);

    const players = await backend.listPlayers();
    expect(players.ok && players.value).toContainEqual({
      id: P1,
      name: 'Alice',
      createdAt: '2026-10-11T18:00:02.000Z',
    });
    expect(await playerNames(backend)).toEqual(NAMES);
  });

  it('never renames an existing player', async () => {
    const backend = freshBackend();
    await backend.savePlayer({ id: P1, name: 'Alicia', createdAt: NOW });

    const summary = await importJson(backend, fixtureDoc());
    expect(summary.playersAdded).toBe(7);
    expect(await playerNames(backend)).toEqual(['Alicia', ...NAMES.slice(1)]);
  });

  it('adds tournament players only for saved items', async () => {
    const backend = freshBackend();
    await backend.saveTournament(fixtureDoc(), null); // stored without its players

    const skipped = await importJson(backend, divergedFixture());
    expect(skipped).toMatchObject({ skipped: 1, playersAdded: 0 });
    expect(await playerNames(backend)).toEqual([]);

    const copied = await importJson(backend, divergedFixture(), { [TOURNAMENT_ID]: 'copy' });
    expect(copied).toMatchObject({ copied: 1, playersAdded: 8 });
  });

  it('always adds dataset players, even when none of their tournaments is saved', async () => {
    const backend = freshBackend();
    await backend.saveTournament(fixtureDoc(), null);
    const alice = { id: P1, name: 'Alice', createdAt: '2026-10-11T18:00:02.000Z' };

    const summary = await importJson(backend, dataset([fixtureDoc()], [alice]));
    expect(summary).toMatchObject({ unchanged: 1, playersAdded: 1 });
    expect(await playerNames(backend)).toEqual(['Alice']);
  });

  it('reports a concurrent save in failed and still applies the other items', async () => {
    const backend = freshBackend();
    await backend.saveTournament(fixturePrefix(10), null);
    const plan = await planImport(backend, parse(dataset([fixtureDoc(), otherTournament()])));
    if (!plan.ok) {
      throw new Error('expected a plan');
    }

    // Another tab saves between plan and apply: the planned revision "1" is now stale.
    await backend.saveTournament(fixturePrefix(11), '1');

    const summary = await applyImport(backend, plan.value, {});
    expect(summary).toMatchObject({ added: 1, updated: 0 });
    expect(summary.failed).toEqual([
      {
        tournamentId: TOURNAMENT_ID,
        name: 'Friday Night Magic',
        error: expect.objectContaining({ code: 'CONFLICT' }),
      },
    ]);
    expect(await storedEvents(backend)).toHaveLength(11);
    expect(await storedEvents(backend, uuid(9000))).toHaveLength(1);
    // Players of the failed item are not added.
    expect(summary.playersAdded).toBe(0);
  });

  it('re-imports an exported dataset into an empty database', async () => {
    const source = freshBackend();
    await importJson(source, dataset([fixtureDoc(), otherTournament()]));
    const built = await buildDataset(source, () => NOW);
    if (!built.ok) {
      throw new Error('expected a dataset');
    }

    const target = freshBackend();
    const summary = await importJson(target, JSON.parse(JSON.stringify(built.value, null, 2)));
    expect(summary).toMatchObject({ added: 2, playersAdded: 8, failed: [], playersFailed: [] });
    expect(await target.listTournaments()).toEqual(await source.listTournaments());
    expect(await target.listPlayers()).toEqual(await source.listPlayers());
  });

  it('reports a failed player save in playersFailed, not in playersAdded', async () => {
    const backend = freshBackend();
    const savePlayer = backend.savePlayer.bind(backend);
    vi.spyOn(backend, 'savePlayer').mockImplementation((player) =>
      player.id === P1
        ? Promise.resolve({ ok: false, error: { code: 'UNAVAILABLE', message: 'blocked' } })
        : savePlayer(player),
    );

    const summary = await importJson(backend, fixtureDoc());
    expect(summary).toMatchObject({ added: 1, playersAdded: 7, failed: [] });
    expect(summary.playersFailed).toEqual([
      { playerId: P1, name: 'Alice', error: { code: 'UNAVAILABLE', message: 'blocked' } },
    ]);
    expect(await playerNames(backend)).toEqual(NAMES.slice(1));
  });
});
