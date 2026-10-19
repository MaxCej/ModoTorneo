import { describe, expect, it } from 'vitest';
import type { TournamentDocument } from '../../domain';
import fixture from '../../domain/fixtures/top4-8players.json';
import { FakeGitHub } from '../../test/fakeGitHub';
import { GitHubBackend, tournamentFileText, tournamentPath } from './githubBackend';

const TOKEN = 'github_pat_backend_test';
const ID = fixture.id;
const PATH = tournamentPath(ID);

let dbCount = 0;

function setup() {
  dbCount += 1;
  const fake = new FakeGitHub({ token: TOKEN });
  const backend = new GitHubBackend({
    owner: fake.owner,
    repo: fake.repo,
    token: TOKEN,
    fetch: fake.fetch,
    dbName: `test-github-backend-${dbCount}`,
  });
  return { fake, backend };
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
