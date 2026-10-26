import { describe, expect, it } from 'vitest';
import {
  createTournament,
  execute,
  playerResults,
  reduce,
  type Command,
  type TournamentCreatedPayload,
  type TournamentDocument,
} from '../../domain';
import { CREATED_PAYLOAD, uuid } from '../../domain/fixtures/builders';
import fixture from '../../domain/fixtures/top4-8players.json';
import { FakeGitHub } from '../../test/fakeGitHub';
import { ModoTorneoDb } from '../db';
import {
  GitHubBackend,
  PLAYERS_PATH,
  playersFileText,
  tournamentFileText,
  tournamentPath,
} from './githubBackend';

const TOKEN = 'github_pat_backend_test';
const ID = fixture.id;
const PATH = tournamentPath(ID);

let dbCount = 0;

function setup() {
  dbCount += 1;
  const dbName = `test-github-backend-${dbCount}`;
  const fake = new FakeGitHub({ token: TOKEN });
  /** A new backend on the same repository and cache database, like a page reload. */
  const open = (fetchFn: typeof fetch = fake.fetch, name = dbName) =>
    new GitHubBackend({
      owner: fake.owner,
      repo: fake.repo,
      token: TOKEN,
      fetch: fetchFn,
      dbName: name,
    });
  return { fake, backend: open(), open, dbName };
}

let idCount = 0;

function newDoc(overrides: Partial<TournamentCreatedPayload>): TournamentDocument {
  const result = createTournament(
    { ...CREATED_PAYLOAD, ...overrides },
    { now: () => '2026-10-11T20:00:00.000Z', newId: () => uuid(7000 + ++idCount) },
  );
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value.doc;
}

/** Reads of single tournament files among the requests after index `from`. */
function fileReads(fake: FakeGitHub, from = 0): string[] {
  return fake.requests
    .slice(from)
    .filter((r) => r.method === 'GET' && r.path.startsWith('tournaments/'))
    .map((r) => r.path);
}

function fixtureDoc(): TournamentDocument {
  return structuredClone(fixture) as TournamentDocument;
}

function fixturePrefix(count: number): TournamentDocument {
  const doc = fixtureDoc();
  return { ...doc, events: doc.events.slice(0, count) };
}

function putMessages(fake: FakeGitHub): string[] {
  return fake.requestsTo('PUT').map((r) => (r.body as { message: string }).message);
}

describe('GitHubBackend tournaments', () => {
  it('creates tournaments/<id>.json as the SPEC 03 export of the document', async () => {
    const { fake, backend } = setup();
    const saved = await backend.saveTournament(fixturePrefix(5), null);
    expect(saved.ok).toBe(true);
    expect(fake.getFile(PATH)).toBe(tournamentFileText(fixturePrefix(5)));
    expect(JSON.parse(fake.getFile(PATH)!)).toEqual(fixturePrefix(5));
    expect(saved.ok && saved.value.revision).toBe(fake.shaOf(PATH));
    expect(fake.requestsTo('PUT')[0]?.body).not.toHaveProperty('sha');
    expect(putMessages(fake)).toEqual(['Save Friday Night Magic (5 events)']);
  });

  it('returns a summary with the blob SHA and the latest event time', async () => {
    const { fake, backend } = setup();
    const saved = await backend.saveTournament(fixtureDoc(), null);
    const doc = fixtureDoc();
    expect(saved.ok && saved.value.summary).toMatchObject({
      id: ID,
      name: 'Friday Night Magic',
      eventCount: doc.events.length,
      playerCount: 8,
      revision: fake.shaOf(PATH),
      updatedAt: doc.events
        .map((e) => e.at)
        .sort()
        .at(-1),
    });
  });

  it('updates with the expected SHA and returns the new one', async () => {
    const { fake, backend } = setup();
    const created = await backend.saveTournament(fixturePrefix(5), null);
    const first = created.ok ? created.value.revision : '';
    const updated = await backend.saveTournament(fixturePrefix(6), first);
    expect(updated.ok && updated.value.revision).toBe(fake.shaOf(PATH));
    expect(updated.ok && updated.value.revision).not.toBe(first);
    expect(fake.requestsTo('PUT')[1]?.body).toMatchObject({ sha: first });
    expect(putMessages(fake)).toEqual([
      'Save Friday Night Magic (5 events)',
      'Save Friday Night Magic (6 events)',
    ]);
  });

  it('returns CONFLICT for a stale SHA and leaves the file unchanged', async () => {
    const { fake, backend } = setup();
    const created = await backend.saveTournament(fixturePrefix(5), null);
    const first = created.ok ? created.value.revision : '';
    await backend.saveTournament(fixturePrefix(6), first);
    const stale = await backend.saveTournament(fixturePrefix(7), first);
    expect(stale.ok || stale.error.code).toBe('CONFLICT');
    expect(JSON.parse(fake.getFile(PATH)!)).toEqual(fixturePrefix(6));
  });

  it('returns CONFLICT when creating an id that exists', async () => {
    const { backend } = setup();
    await backend.saveTournament(fixturePrefix(5), null);
    const again = await backend.saveTournament(fixturePrefix(5), null);
    expect(again.ok || again.error.code).toBe('CONFLICT');
  });

  it('rejects an invalid document without a request', async () => {
    const { fake, backend } = setup();
    const doc = fixtureDoc();
    const broken = { ...doc, events: doc.events.slice(1) };
    const saved = await backend.saveTournament(broken, null);
    expect(saved.ok || saved.error.code).toBe('INVALID_DOCUMENT');
    expect(fake.requests).toHaveLength(0);
  });

  it('loads a saved tournament with its SHA as revision', async () => {
    const { fake, backend } = setup();
    await backend.saveTournament(fixtureDoc(), null);
    const loaded = await backend.loadTournament(ID);
    expect(loaded.ok && loaded.value.doc).toEqual(fixtureDoc());
    expect(loaded.ok && loaded.value.revision).toBe(fake.shaOf(PATH));
    expect(loaded.ok && loaded.value.state.status).toBe('finished');
  });

  it('returns NOT_FOUND for a missing tournament', async () => {
    const { backend } = setup();
    const loaded = await backend.loadTournament(ID);
    expect(loaded).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: `No tournament with id ${ID}` },
    });
  });

  it('returns INVALID_DOCUMENT for broken JSON, a bad log or an id mismatch', async () => {
    const { fake, backend } = setup();
    fake.setFile(PATH, '{ nope');
    const broken = await backend.loadTournament(ID);
    expect(broken.ok || broken.error.code).toBe('INVALID_DOCUMENT');
    expect(broken.ok || broken.error.message).toContain(PATH);

    fake.setFile(PATH, JSON.stringify({ ...fixtureDoc(), events: [] }));
    const badLog = await backend.loadTournament(ID);
    expect(badLog.ok || badLog.error.code).toBe('INVALID_DOCUMENT');

    const other = '00000000-0000-4000-8000-00000000abcd';
    fake.setFile(tournamentPath(other), tournamentFileText(fixtureDoc()));
    const mismatch = await backend.loadTournament(other);
    expect(mismatch.ok || mismatch.error.code).toBe('INVALID_DOCUMENT');
  });

  it('deletes with the expected SHA and the commit message', async () => {
    const { fake, backend } = setup();
    const created = await backend.saveTournament(fixturePrefix(5), null);
    const revision = created.ok ? created.value.revision : '';
    expect(await backend.deleteTournament(ID, revision)).toEqual({ ok: true, value: undefined });
    expect(fake.getFile(PATH)).toBeUndefined();
    expect(fake.requestsTo('DELETE')[0]?.body).toEqual({
      message: 'Delete Friday Night Magic',
      sha: revision,
    });
  });

  it('returns CONFLICT on delete with a stale SHA and NOT_FOUND for a missing file', async () => {
    const { fake, backend } = setup();
    await backend.saveTournament(fixturePrefix(5), null);
    const stale = await backend.deleteTournament(ID, 'stale');
    expect(stale.ok || stale.error.code).toBe('CONFLICT');
    expect(fake.getFile(PATH)).toBeDefined();
    fake.removeFile(PATH);
    const missing = await backend.deleteTournament(ID, 'stale');
    expect(missing.ok || missing.error.code).toBe('NOT_FOUND');
  });

  it('returns UNAUTHORIZED for a rejected token', async () => {
    const { fake, backend } = setup();
    fake.token = 'rotated';
    const saved = await backend.saveTournament(fixturePrefix(5), null);
    expect(saved.ok || saved.error.code).toBe('UNAUTHORIZED');
    const loaded = await backend.loadTournament(ID);
    expect(loaded.ok || loaded.error.code).toBe('UNAUTHORIZED');
  });

  it('returns UNAUTHORIZED when the token cannot write', async () => {
    const { fake, backend } = setup();
    fake.push = false;
    const saved = await backend.saveTournament(fixturePrefix(5), null);
    expect(saved.ok || saved.error.code).toBe('UNAUTHORIZED');
  });

  it('returns UNAVAILABLE offline and when rate limited', async () => {
    const { fake, backend } = setup();
    fake.offline = true;
    const offline = await backend.saveTournament(fixturePrefix(5), null);
    expect(offline.ok || offline.error.code).toBe('UNAVAILABLE');
    fake.offline = false;
    fake.rateLimited = true;
    const limited = await backend.loadTournament(ID);
    expect(limited.ok || limited.error.code).toBe('UNAVAILABLE');
  });
});

describe('GitHubBackend listTournaments', () => {
  it('carries the player results on saved and listed summaries', async () => {
    const { backend, open } = setup();
    const players = playerResults(reduce(fixtureDoc().events, ID));
    expect(players).toHaveLength(8);
    const saved = await backend.saveTournament(fixtureDoc(), null);
    expect(saved.ok && saved.value.summary.players).toEqual(players);
    const cached = await backend.listTournaments();
    expect(cached.ok && cached.value[0].players).toEqual(players);
    // A fresh cache database recomputes the summary from the file.
    const cold = await open(undefined, `${ID}-cold-${dbCount}`).listTournaments();
    expect(cold.ok && cold.value[0].players).toEqual(players);
  });

  it('carries archetypes (guests included) and archetype per registry player', async () => {
    const { backend, open } = setup();
    let doc = newDoc({ name: 'Decks' });
    const commands: Command[] = [
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
    ];
    for (const command of commands) {
      const result = execute(doc, command);
      if (!result.ok) {
        throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
      }
      doc = result.value.doc;
    }

    const saved = await backend.saveTournament(doc, null);
    expect(saved.ok && saved.value.summary.archetypes).toEqual(['Burn', 'Elves']);
    const cached = await backend.listTournaments();
    expect(cached.ok && cached.value[0].archetypes).toEqual(['Burn', 'Elves']);
    // A fresh cache database recomputes the summary from the file.
    const cold = await open(undefined, `decks-cold-${dbCount}`).listTournaments();
    expect(cold.ok && cold.value[0].archetypes).toEqual(['Burn', 'Elves']);
    expect(cold.ok && cold.value[0].players.map((p) => [p.playerName, p.archetype])).toEqual([
      ['Alice', 'Burn'],
      ['Carmen', null],
    ]);
  });

  it('returns an empty list for an empty repository', async () => {
    const { fake, backend } = setup();
    expect(await backend.listTournaments()).toEqual({ ok: true, value: [] });
    expect(fake.requests.map((r) => r.path)).toEqual(['tournaments']);
  });

  it('lists summaries sorted by date descending, then name', async () => {
    const { backend } = setup();
    for (const doc of [
      newDoc({ name: 'Beta', date: '2026-10-01' }),
      newDoc({ name: 'Alpha', date: '2026-10-01' }),
      newDoc({ name: 'Zeta', date: '2026-10-09' }),
    ]) {
      await backend.saveTournament(doc, null);
    }
    const list = await backend.listTournaments();
    expect(list.ok && list.value.map((s) => s.name)).toEqual(['Zeta', 'Alpha', 'Beta']);
  });

  it('reads no file whose SHA matches the cache', async () => {
    const { fake, backend, open } = setup();
    await backend.saveTournament(newDoc({ name: 'One' }), null);
    await backend.saveTournament(newDoc({ name: 'Two' }), null);
    // Saves fill the cache, so even the first list after a reload reads no file.
    const before = fake.requests.length;
    const listed = await open().listTournaments();
    expect(listed.ok && listed.value).toHaveLength(2);
    expect(fileReads(fake, before)).toEqual([]);
  });

  it('reads exactly the files whose SHA changed', async () => {
    const { fake, backend, open } = setup();
    const one = newDoc({ name: 'One' });
    const two = newDoc({ name: 'Two' });
    await backend.saveTournament(one, null);
    await backend.saveTournament(two, null);
    // Another device renames "Two": its file changes behind this cache.
    const renamed = { ...newDoc({ name: 'Two renamed' }), id: two.id };
    fake.setFile(tournamentPath(two.id), tournamentFileText(renamed));
    const before = fake.requests.length;
    const listed = await open().listTournaments();
    expect(fileReads(fake, before)).toEqual([tournamentPath(two.id)]);
    expect(listed.ok && listed.value.map((s) => s.name).sort()).toEqual(['One', 'Two renamed']);
    expect(listed.ok && listed.value.find((s) => s.id === two.id)?.revision).toBe(
      fake.shaOf(tournamentPath(two.id)),
    );
    // The new SHA is cached now.
    const again = fake.requests.length;
    await open().listTournaments();
    expect(fileReads(fake, again)).toEqual([]);
  });

  it('drops the cache row of a file no longer listed', async () => {
    const { fake, backend, dbName } = setup();
    const one = newDoc({ name: 'One' });
    const two = newDoc({ name: 'Two' });
    await backend.saveTournament(one, null);
    await backend.saveTournament(two, null);
    fake.removeFile(tournamentPath(two.id));
    const listed = await backend.listTournaments();
    expect(listed.ok && listed.value.map((s) => s.id)).toEqual([one.id]);
    const db = new ModoTorneoDb(dbName);
    expect((await db.githubSummaries.toArray()).map((row) => row.id)).toEqual([one.id]);
    db.close();
  });

  it('removes the cache row on delete', async () => {
    const { backend, dbName } = setup();
    const doc = newDoc({ name: 'One' });
    const saved = await backend.saveTournament(doc, null);
    await backend.deleteTournament(doc.id, saved.ok ? saved.value.revision : '');
    const db = new ModoTorneoDb(dbName);
    expect(await db.githubSummaries.count()).toBe(0);
    db.close();
  });

  it('fails the whole call with INVALID_DOCUMENT naming the invalid file', async () => {
    const { fake, backend } = setup();
    await backend.saveTournament(newDoc({ name: 'One' }), null);
    const broken = uuid(9999);
    fake.setFile(tournamentPath(broken), '{ "broken": true }');
    const list = await backend.listTournaments();
    expect(list.ok || list.error.code).toBe('INVALID_DOCUMENT');
    expect(list.ok || list.error.message).toContain(tournamentPath(broken));
  });

  it('ignores files that are not <uuid>.json', async () => {
    const { fake, backend } = setup();
    const doc = newDoc({ name: 'One' });
    await backend.saveTournament(doc, null);
    fake.setFile('tournaments/README.md', '# notes');
    fake.setFile('tournaments/notes.json', '{}');
    fake.setFile(`tournaments/archive/${uuid(1)}.json`, '{}');
    fake.setFile('README.md', '# data');
    const list = await backend.listTournaments();
    expect(list.ok && list.value.map((s) => s.id)).toEqual([doc.id]);
  });

  it('reads at most 4 files in parallel', async () => {
    const { fake, backend, open } = setup();
    for (let i = 0; i < 9; i += 1) {
      await backend.saveTournament(newDoc({ name: `T${i}` }), null);
    }
    let running = 0;
    let peak = 0;
    const slowFetch: typeof fetch = async (input, init) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await fake.fetch(input, init);
      } finally {
        running -= 1;
      }
    };
    // A fresh cache database: every file must be read.
    dbCount += 1;
    const cold = open(slowFetch, `test-github-backend-${dbCount}`);
    const before = fake.requests.length;
    const list = await cold.listTournaments();
    expect(list.ok && list.value).toHaveLength(9);
    expect(fileReads(fake, before)).toHaveLength(9);
    expect(peak).toBe(4);
  });

  it('returns UNAUTHORIZED and UNAVAILABLE from the listing', async () => {
    const { fake, backend } = setup();
    fake.token = 'rotated';
    const rejected = await backend.listTournaments();
    expect(rejected.ok || rejected.error.code).toBe('UNAUTHORIZED');
    fake.offline = true;
    const offline = await backend.listTournaments();
    expect(offline.ok || offline.error.code).toBe('UNAVAILABLE');
  });
});

describe('GitHubBackend players', () => {
  const alice = { id: uuid(201), name: 'Alice', createdAt: '2026-10-11T18:30:00.000Z' };
  const bob = { id: uuid(202), name: 'Bóbby', createdAt: '2026-10-11T18:31:00.000Z' };
  const carol = { id: uuid(203), name: 'Carol', createdAt: '2026-10-11T18:32:00.000Z' };

  function storedPlayers(fake: FakeGitHub) {
    return JSON.parse(fake.getFile(PLAYERS_PATH) ?? 'null') as {
      kind: string;
      schemaVersion: number;
      players: Array<{ id: string; name: string }>;
    };
  }

  it('returns an empty list when players.json is missing', async () => {
    const { backend } = setup();
    expect(await backend.listPlayers()).toEqual({ ok: true, value: [] });
  });

  it('creates players.json, then upserts by id with players sorted by id', async () => {
    const { fake, backend } = setup();
    expect(await backend.savePlayer(bob)).toEqual({ ok: true, value: undefined });
    expect(fake.requestsTo('PUT')[0]?.body).not.toHaveProperty('sha');
    await backend.savePlayer(alice);
    await backend.savePlayer({ ...bob, name: '  Bob  ' });
    const file = storedPlayers(fake);
    expect(file.kind).toBe('modotorneo-players');
    expect(file.schemaVersion).toBe(1);
    expect(file.players.map((p) => [p.id, p.name])).toEqual([
      [alice.id, 'Alice'],
      [bob.id, 'Bob'],
    ]);
    expect(fake.getFile(PLAYERS_PATH)).toBe(playersFileText([alice, { ...bob, name: 'Bob' }]));
    expect(putMessages(fake)).toEqual([
      'Save player Bóbby',
      'Save player Alice',
      'Save player Bob',
    ]);
  });

  it('lists players sorted by name', async () => {
    const { backend } = setup();
    for (const player of [carol, bob, alice]) {
      await backend.savePlayer(player);
    }
    const list = await backend.listPlayers();
    expect(list.ok && list.value.map((p) => p.name)).toEqual(['Alice', 'Bóbby', 'Carol']);
  });

  it("succeeds after one CONFLICT, keeping the other device's player", async () => {
    const { fake, backend } = setup();
    await backend.savePlayer(alice);
    let first = true;
    const racingFetch: typeof fetch = async (input, init) => {
      if (first && init?.method === 'PUT') {
        first = false;
        // Another device adds Carol between this read and this write.
        fake.setFile(PLAYERS_PATH, playersFileText([alice, carol]));
      }
      return fake.fetch(input, init);
    };
    const racing = new GitHubBackend({
      owner: fake.owner,
      repo: fake.repo,
      token: TOKEN,
      fetch: racingFetch,
      dbName: 'test-github-backend-racing',
    });
    expect(await racing.savePlayer(bob)).toEqual({ ok: true, value: undefined });
    expect(storedPlayers(fake).players.map((p) => p.name)).toEqual(['Alice', 'Bóbby', 'Carol']);
  });

  it('returns CONFLICT after two conflicts', async () => {
    const { fake, backend } = setup();
    await backend.savePlayer(alice);
    fake.failNext('PUT', 409, 2);
    const saved = await backend.savePlayer(bob);
    expect(saved.ok || saved.error.code).toBe('CONFLICT');
    expect(fake.requestsTo('PUT')).toHaveLength(3);
    expect(storedPlayers(fake).players.map((p) => p.name)).toEqual(['Alice']);
  });

  it('rejects an invalid player without a request', async () => {
    const { fake, backend } = setup();
    const saved = await backend.savePlayer({ ...alice, name: '   ' });
    expect(saved.ok || saved.error.code).toBe('INVALID_PLAYER');
    expect(fake.requests).toHaveLength(0);
  });

  it('returns INVALID_PLAYER for an invalid players.json and does not overwrite it', async () => {
    const { fake, backend } = setup();
    fake.setFile(PLAYERS_PATH, '{ "kind": "something-else" }');
    const list = await backend.listPlayers();
    expect(list.ok || list.error.code).toBe('INVALID_PLAYER');
    expect(list.ok || list.error.message).toContain(PLAYERS_PATH);
    const saved = await backend.savePlayer(alice);
    expect(saved.ok || saved.error.code).toBe('INVALID_PLAYER');
    expect(fake.requestsTo('PUT')).toHaveLength(0);
  });

  it('returns UNAVAILABLE offline', async () => {
    const { fake, backend } = setup();
    fake.offline = true;
    const list = await backend.listPlayers();
    expect(list.ok || list.error.code).toBe('UNAVAILABLE');
    const saved = await backend.savePlayer(alice);
    expect(saved.ok || saved.error.code).toBe('UNAVAILABLE');
  });
});
