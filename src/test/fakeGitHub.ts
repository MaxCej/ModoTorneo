// In-memory fake of the parts of the GitHub REST API that the GitHub backend uses
// (repository, Contents API, Git blobs). Shared by Vitest (through `fake.fetch`) and
// Playwright (through `fake.handle` inside `page.route`). No imports, so it runs in both.

export type FakeGitHubOptions = {
  owner?: string;
  repo?: string;
  token?: string;
  private?: boolean;
  push?: boolean;
  /** Files above this many bytes come back as `encoding: "none"`, like GitHub over 1 MB. */
  largeFileBytes?: number;
};

export type FakeRequest = {
  method: string;
  url: string;
  /** Repository-relative path for Contents API calls, else the URL pathname. */
  path: string;
  headers: Record<string, string>;
  body: unknown;
};

export type FakeResponse = { status: number; headers: Record<string, string>; body: string };

type Failure = { method: string; status: number; headers: Record<string, string> };

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Authorization, Accept, Content-Type, X-GitHub-Api-Version',
  'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
  'access-control-expose-headers': 'X-RateLimit-Remaining, Retry-After',
};

/** Deterministic 40-hex "SHA" of a text: five FNV-1a passes with different seeds. */
export function fakeSha(text: string): string {
  let out = '';
  for (const seed of [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]) {
    let hash = seed >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    out += hash.toString(16).padStart(8, '0');
  }
  return out;
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  // GitHub wraps base64 content at 60 characters.
  return (btoa(binary).match(/.{1,60}/g) ?? []).join('\n');
}

function fromBase64(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export class FakeGitHub {
  owner: string;
  repo: string;
  token: string;
  private: boolean;
  push: boolean;
  largeFileBytes: number;
  /** Every request but fetch fails with a network error. */
  offline = false;
  /** Every request but answers 403 with `x-ratelimit-remaining: 0`. */
  rateLimited = false;

  readonly requests: FakeRequest[] = [];
  private readonly files = new Map<string, { text: string; sha: string }>();
  private readonly blobs = new Map<string, string>();
  private readonly failures: Failure[] = [];

  constructor(options: FakeGitHubOptions = {}) {
    this.owner = options.owner ?? 'alice';
    this.repo = options.repo ?? 'mtg-data';
    this.token = options.token ?? 'github_pat_fake';
    this.private = options.private ?? true;
    this.push = options.push ?? true;
    this.largeFileBytes = options.largeFileBytes ?? 1024 * 1024;
  }

  /** Writes a file directly (no request is logged). Returns its SHA. */
  setFile(path: string, text: string): string {
    const sha = fakeSha(text);
    this.files.set(path, { text, sha });
    this.blobs.set(sha, text);
    return sha;
  }

  getFile(path: string): string | undefined {
    return this.files.get(path)?.text;
  }

  shaOf(path: string): string | undefined {
    return this.files.get(path)?.sha;
  }

  removeFile(path: string): void {
    this.files.delete(path);
  }

  paths(): string[] {
    return [...this.files.keys()].sort();
  }

  /** The next `times` requests with this method answer `status` instead of running. */
  failNext(method: string, status: number, times = 1, headers: Record<string, string> = {}): void {
    for (let i = 0; i < times; i += 1) {
      this.failures.push({ method: method.toUpperCase(), status, headers });
    }
  }

  /** Requests of one method to one repository-relative path. */
  requestsTo(method: string, path?: string): FakeRequest[] {
    return this.requests.filter(
      (r) => r.method === method.toUpperCase() && (path === undefined || r.path === path),
    );
  }

  /** `null` means the request failed at the network level. */
  handle(input: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
  }): FakeResponse | null {
    const method = input.method.toUpperCase();
    if (method === 'OPTIONS') {
      return { status: 204, headers: CORS_HEADERS, body: '' };
    }
    const url = new URL(input.url);
    const headers = Object.fromEntries(
      Object.entries(input.headers).map(([key, value]) => [key.toLowerCase(), value]),
    );
    let body: unknown = null;
    if (input.body) {
      try {
        body = JSON.parse(input.body);
      } catch {
        body = input.body;
      }
    }
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const isRepo =
      segments[0] === 'repos' &&
      segments[1]?.toLowerCase() === this.owner.toLowerCase() &&
      segments[2]?.toLowerCase() === this.repo.toLowerCase();
    const rest = segments.slice(3);
    const contentPath = isRepo && rest[0] === 'contents' ? rest.slice(1).join('/') : null;
    this.requests.push({
      method,
      url: input.url,
      path: contentPath ?? url.pathname,
      headers,
      body,
    });

    if (this.offline) {
      return null;
    }
    if (headers.authorization !== `Bearer ${this.token}`) {
      return this.json(401, { message: 'Bad credentials' });
    }
    if (this.rateLimited) {
      return this.json(
        403,
        { message: 'API rate limit exceeded' },
        { 'x-ratelimit-remaining': '0' },
      );
    }
    const failureIndex = this.failures.findIndex((f) => f.method === method);
    if (failureIndex >= 0) {
      const [failure] = this.failures.splice(failureIndex, 1);
      return this.json(
        failure!.status,
        { message: `Injected ${failure!.status}` },
        failure!.headers,
      );
    }
    if (!isRepo) {
      return this.json(404, { message: 'Not Found' });
    }
    if (rest.length === 0 && method === 'GET') {
      return this.json(200, {
        full_name: `${this.owner}/${this.repo}`,
        private: this.private,
        permissions: { admin: false, push: this.push, pull: true },
      });
    }
    if (rest[0] === 'git' && rest[1] === 'blobs' && rest[2] && method === 'GET') {
      const text = this.blobs.get(rest[2]);
      return text === undefined
        ? this.json(404, { message: 'Not Found' })
        : this.json(200, {
            sha: rest[2],
            size: byteLength(text),
            encoding: 'base64',
            content: toBase64(text),
          });
    }
    if (contentPath !== null) {
      if (method === 'GET') {
        return this.read(contentPath);
      }
      if (method === 'PUT') {
        return this.write(contentPath, body);
      }
      if (method === 'DELETE') {
        return this.remove(contentPath, body);
      }
    }
    return this.json(404, { message: 'Not Found' });
  }

  /** `fetch`-compatible entry point for Vitest. Offline throws a `TypeError` like browsers. */
  fetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = request ? request.url : String(input);
    const method = init?.method ?? request?.method ?? 'GET';
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? request?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const body = typeof init?.body === 'string' ? init.body : null;
    const response = this.handle({ method, url, headers, body });
    if (response === null) {
      throw new TypeError('Failed to fetch');
    }
    return new Response(response.status === 204 ? null : response.body, {
      status: response.status,
      headers: response.headers,
    });
  };

  private json(status: number, value: unknown, headers: Record<string, string> = {}): FakeResponse {
    return {
      status,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8', ...headers },
      body: JSON.stringify(value),
    };
  }

  private entry(path: string, sha: string, type: 'file' | 'dir', size: number) {
    return { name: path.split('/').pop(), path, sha, size, type };
  }

  private read(path: string): FakeResponse {
    const file = this.files.get(path);
    if (file) {
      const size = byteLength(file.text);
      const large = size > this.largeFileBytes;
      return this.json(200, {
        ...this.entry(path, file.sha, 'file', size),
        encoding: large ? 'none' : 'base64',
        content: large ? '' : toBase64(file.text),
      });
    }
    const prefix = path === '' ? '' : `${path}/`;
    const children = new Map<string, ReturnType<FakeGitHub['entry']>>();
    for (const [filePath, { text, sha }] of this.files) {
      if (!filePath.startsWith(prefix)) {
        continue;
      }
      const [name, ...deeper] = filePath.slice(prefix.length).split('/');
      const childPath = `${prefix}${name}`;
      children.set(
        childPath,
        deeper.length === 0
          ? this.entry(childPath, sha, 'file', byteLength(text))
          : this.entry(childPath, fakeSha(childPath), 'dir', 0),
      );
    }
    if (children.size === 0) {
      return this.json(404, { message: 'Not Found' });
    }
    return this.json(200, [...children.values()]);
  }

  private write(path: string, body: unknown): FakeResponse {
    if (!this.push) {
      return this.json(403, { message: 'Resource not accessible by personal access token' });
    }
    const { content, sha, message } = (body ?? {}) as {
      content?: unknown;
      sha?: unknown;
      message?: unknown;
    };
    if (typeof content !== 'string' || typeof message !== 'string') {
      return this.json(422, { message: 'Invalid request.' });
    }
    const existing = this.files.get(path);
    if (existing && sha === undefined) {
      return this.json(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' });
    }
    if (sha !== undefined && existing?.sha !== sha) {
      return this.json(409, { message: `${path} does not match ${String(sha)}` });
    }
    const newSha = this.setFile(path, fromBase64(content));
    return this.json(existing ? 200 : 201, {
      content: this.entry(path, newSha, 'file', byteLength(this.files.get(path)!.text)),
      commit: { sha: fakeSha(`${message}:${newSha}`), message },
    });
  }

  private remove(path: string, body: unknown): FakeResponse {
    if (!this.push) {
      return this.json(403, { message: 'Resource not accessible by personal access token' });
    }
    const { sha } = (body ?? {}) as { sha?: unknown };
    const existing = this.files.get(path);
    if (!existing) {
      return this.json(404, { message: 'Not Found' });
    }
    if (existing.sha !== sha) {
      return this.json(409, { message: `${path} does not match ${String(sha)}` });
    }
    this.files.delete(path);
    return this.json(200, { content: null, commit: { sha: fakeSha(`delete:${path}`) } });
  }
}
