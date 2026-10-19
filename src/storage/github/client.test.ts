import { describe, expect, it } from 'vitest';
import { FakeGitHub, type FakeGitHubOptions } from '../../test/fakeGitHub';
import {
  decodeBase64,
  encodeBase64,
  GitHubClient,
  responseError,
  type GitHubOperation,
} from './client';

const TOKEN = 'github_pat_secret_123';

function setup(options: FakeGitHubOptions = {}) {
  const fake = new FakeGitHub({ token: TOKEN, ...options });
  const client = new GitHubClient({
    owner: fake.owner,
    repo: fake.repo,
    token: TOKEN,
    fetch: fake.fetch,
  });
  return { fake, client };
}

function response(status: number, headers: Record<string, string> = {}, message = 'msg') {
  return { status, headers: new Headers(headers), body: { message } };
}

describe('base64', () => {
  it('round-trips UTF-8 text with accents and emoji', () => {
    const text = 'José Ñúñez — Bóbby 🃏\n';
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it('decodes base64 wrapped with newlines', () => {
    const encoded = encodeBase64('x'.repeat(200));
    const wrapped = (encoded.match(/.{1,60}/g) ?? []).join('\n');
    expect(decodeBase64(wrapped)).toBe('x'.repeat(200));
  });

  it('encodes large texts', () => {
    const text = 'á'.repeat(200_000);
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });
});

describe('responseError status mapping', () => {
  const cases: Array<[string, number, Record<string, string>, GitHubOperation, string]> = [
    ['401', 401, {}, 'read', 'UNAUTHORIZED'],
    ['403 with remaining 0', 403, { 'x-ratelimit-remaining': '0' }, 'write', 'UNAVAILABLE'],
    ['403 with retry-after', 403, { 'retry-after': '60' }, 'read', 'UNAVAILABLE'],
    ['429', 429, {}, 'read', 'UNAVAILABLE'],
    ['other 403', 403, {}, 'write', 'UNAUTHORIZED'],
    ['404 on read', 404, {}, 'read', 'NOT_FOUND'],
    ['404 on list', 404, {}, 'list', 'NOT_FOUND'],
    ['404 on delete', 404, {}, 'delete', 'NOT_FOUND'],
    ['404 on the repository', 404, {}, 'repo', 'UNAUTHORIZED'],
    ['404 on write', 404, {}, 'write', 'UNAUTHORIZED'],
    ['409 on write', 409, {}, 'write', 'CONFLICT'],
    ['409 on delete', 409, {}, 'delete', 'CONFLICT'],
    ['422 on write', 422, {}, 'write', 'CONFLICT'],
    ['500', 500, {}, 'read', 'UNAVAILABLE'],
    ['503', 503, {}, 'write', 'UNAVAILABLE'],
  ];
  it.each(cases)('%s', (_name, status, headers, operation, code) => {
    expect(responseError(response(status, headers), operation, 'x').code).toBe(code);
  });

  it('treats a 403 whose message names the secondary rate limit as UNAVAILABLE', () => {
    const error = responseError(
      response(403, {}, 'You have exceeded a secondary rate limit.'),
      'write',
      'x',
    );
    expect(error.code).toBe('UNAVAILABLE');
    expect(error.message).toMatch(/rate limit/);
  });
});

describe('GitHubClient', () => {
  it('sends the auth, accept and version headers with no-store and no ref', async () => {
    const { fake, client } = setup();
    fake.setFile('players.json', '{}');
    let init: RequestInit | undefined;
    let url = '';
    const spy = new GitHubClient({
      owner: fake.owner,
      repo: fake.repo,
      token: TOKEN,
      fetch: (input, options) => {
        url = String(input);
        init = options;
        return fake.fetch(input, options);
      },
    });
    await spy.readFile('players.json');
    expect(url).toBe('https://api.github.com/repos/alice/mtg-data/contents/players.json');
    expect(init?.cache).toBe('no-store');
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
    expect(url).not.toMatch(/ref=|branch=/);
    await client.writeFile('a.json', 'x', null, 'msg');
    expect(fake.requestsTo('PUT')[0]?.body).not.toHaveProperty('branch');
  });

  it('writes, reads back and updates a UTF-8 file', async () => {
    const { fake, client } = setup();
    const created = await client.writeFile('players.json', 'Ñúñez\n', null, 'Create');
    expect(created).toEqual({ ok: true, value: { sha: fake.shaOf('players.json') } });
    expect(fake.getFile('players.json')).toBe('Ñúñez\n');

    const read = await client.readFile('players.json');
    expect(read).toEqual({
      ok: true,
      value: { text: 'Ñúñez\n', sha: fake.shaOf('players.json') },
    });

    const sha = created.ok ? created.value.sha : '';
    const updated = await client.writeFile('players.json', 'Bob\n', sha, 'Update');
    expect(updated.ok).toBe(true);
    expect(fake.getFile('players.json')).toBe('Bob\n');
    expect(fake.requestsTo('PUT').map((r) => (r.body as { message: string }).message)).toEqual([
      'Create',
      'Update',
    ]);
  });

  it('maps a stale SHA and a create of an existing file to CONFLICT', async () => {
    const { fake, client } = setup();
    fake.setFile('a.json', 'one');
    const stale = await client.writeFile('a.json', 'two', 'deadbeef', 'msg');
    expect(stale.ok || stale.error.code).toBe('CONFLICT');
    const create = await client.writeFile('a.json', 'two', null, 'msg');
    expect(create.ok || create.error.code).toBe('CONFLICT');
    expect(fake.getFile('a.json')).toBe('one');
  });

  it('reads a large file through the blob endpoint', async () => {
    const { fake, client } = setup({ largeFileBytes: 10 });
    const text = 'Bóbby '.repeat(10);
    const sha = fake.setFile('big.json', text);
    const read = await client.readFile('big.json');
    expect(read).toEqual({ ok: true, value: { text, sha } });
    expect(fake.requests.map((r) => r.path)).toEqual([
      'big.json',
      `/repos/alice/mtg-data/git/blobs/${sha}`,
    ]);
  });

  it('lists a directory, and a missing one is NOT_FOUND', async () => {
    const { fake, client } = setup();
    expect(await client.listDirectory('tournaments')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    const sha = fake.setFile('tournaments/a.json', 'a');
    fake.setFile('tournaments/nested/b.json', 'b');
    const listed = await client.listDirectory('tournaments');
    expect(listed.ok && listed.value.map(({ path, type }) => ({ path, type }))).toEqual([
      { path: 'tournaments/a.json', type: 'file' },
      { path: 'tournaments/nested', type: 'dir' },
    ]);
    expect(listed.ok && listed.value[0]?.sha).toBe(sha);
  });

  it('deletes a file with its SHA; a missing file is NOT_FOUND', async () => {
    const { fake, client } = setup();
    const sha = fake.setFile('a.json', 'a');
    expect(await client.deleteFile('a.json', 'stale', 'Delete')).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(await client.deleteFile('a.json', sha, 'Delete')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(fake.getFile('a.json')).toBeUndefined();
    expect(await client.deleteFile('a.json', sha, 'Delete')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('maps a wrong token to UNAUTHORIZED', async () => {
    const { fake } = setup();
    const wrong = new GitHubClient({
      owner: fake.owner,
      repo: fake.repo,
      token: 'nope',
      fetch: fake.fetch,
    });
    const result = await wrong.readFile('a.json');
    expect(result.ok || result.error.code).toBe('UNAUTHORIZED');
  });

  it('maps a network failure to UNAVAILABLE', async () => {
    const { fake, client } = setup();
    fake.offline = true;
    expect(await client.readFile('a.json')).toEqual({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'Cannot reach GitHub: Failed to fetch' },
    });
  });

  it('maps a rate limit to UNAVAILABLE with a rate-limit message', async () => {
    const { fake, client } = setup();
    fake.rateLimited = true;
    const result = await client.writeFile('a.json', 'a', null, 'msg');
    expect(result.ok || result.error.code).toBe('UNAVAILABLE');
    expect(result.ok || result.error.message).toMatch(/rate limit/);
  });

  it('maps a 5xx to UNAVAILABLE', async () => {
    const { fake, client } = setup();
    fake.failNext('GET', 502);
    const result = await client.readFile('a.json');
    expect(result.ok || result.error.code).toBe('UNAVAILABLE');
  });

  it('never puts the token in a URL, a body or an error message', async () => {
    const { fake, client } = setup();
    fake.setFile('a.json', 'a');
    const errors: string[] = [];
    for (const status of [401, 403, 404, 409, 422, 500]) {
      fake.failNext('PUT', status);
      const result = await client.writeFile('a.json', 'b', 'x', 'msg');
      if (!result.ok) {
        errors.push(result.error.message);
      }
    }
    fake.offline = true;
    const offline = await client.readFile('a.json');
    if (!offline.ok) {
      errors.push(offline.error.message);
    }
    expect(errors).toHaveLength(7);
    const sent = fake.requests.map((r) => `${r.url} ${JSON.stringify(r.body)}`);
    for (const text of [...errors, ...sent]) {
      expect(text).not.toContain(TOKEN);
    }
  });
});
