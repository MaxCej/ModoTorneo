import { describe, expect, it } from 'vitest';
import { FakeGitHub } from '../../test/fakeGitHub';
import { testConnection } from './testConnection';

const TOKEN = 'github_pat_connection';

function check(
  fake: FakeGitHub,
  overrides: Partial<{ owner: string; repo: string; token: string }> = {},
) {
  return testConnection(
    { owner: fake.owner, repo: fake.repo, token: TOKEN, ...overrides },
    fake.fetch,
  );
}

describe('testConnection', () => {
  it('is ok for a private repository with push access', async () => {
    const fake = new FakeGitHub({ token: TOKEN });
    expect(await check(fake)).toEqual({ ok: true, fullName: 'alice/mtg-data', private: true });
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /repos/alice/mtg-data',
    ]);
  });

  it('reports a public repository', async () => {
    const fake = new FakeGitHub({ token: TOKEN, private: false });
    expect(await check(fake)).toEqual({ ok: true, fullName: 'alice/mtg-data', private: false });
  });

  it('is unauthorized for a rejected token (401) and a forbidden one (403)', async () => {
    const fake = new FakeGitHub({ token: TOKEN });
    expect(await check(fake, { token: 'wrong' })).toMatchObject({
      ok: false,
      reason: 'unauthorized',
    });
    fake.failNext('GET', 403);
    expect(await check(fake)).toMatchObject({ ok: false, reason: 'unauthorized' });
  });

  it('is notFound for a repository the token cannot see', async () => {
    const fake = new FakeGitHub({ token: TOKEN });
    expect(await check(fake, { repo: 'other' })).toMatchObject({ ok: false, reason: 'notFound' });
  });

  it('is readOnly without push permission, or with no permissions at all', async () => {
    const fake = new FakeGitHub({ token: TOKEN, push: false });
    expect(await check(fake)).toMatchObject({ ok: false, reason: 'readOnly' });
    const bare: typeof fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ full_name: 'alice/mtg-data', private: true }), {
          status: 200,
        }),
      );
    expect(
      await testConnection({ owner: 'alice', repo: 'mtg-data', token: TOKEN }, bare),
    ).toMatchObject({ ok: false, reason: 'readOnly' });
  });

  it('is unavailable offline, on a 5xx and when rate limited', async () => {
    const fake = new FakeGitHub({ token: TOKEN });
    fake.offline = true;
    expect(await check(fake)).toEqual({
      ok: false,
      reason: 'unavailable',
      message: 'Failed to fetch',
    });
    fake.offline = false;
    fake.failNext('GET', 503);
    expect(await check(fake)).toMatchObject({ ok: false, reason: 'unavailable' });
    fake.rateLimited = true;
    expect(await check(fake)).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('never puts the token in a message', async () => {
    const fake = new FakeGitHub({ token: TOKEN });
    const results = [await check(fake, { token: 'wrong' }), await check(fake, { repo: 'nope' })];
    fake.offline = true;
    results.push(await check(fake));
    for (const result of results) {
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    }
  });
});
