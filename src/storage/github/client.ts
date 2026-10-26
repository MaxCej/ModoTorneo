import { z } from 'zod';
import { err, ok, type Result } from '../../domain';
import type { StorageError } from '../types';

export const GITHUB_API = 'https://api.github.com';

export type GitHubTarget = {
  owner: string;
  repo: string;
  token: string;
  fetch?: typeof fetch;
};

/** What a request was for: the same status means different things per operation. */
export type GitHubOperation = 'repo' | 'list' | 'read' | 'write' | 'delete';

export type GitHubResponse = { status: number; headers: Headers; body: unknown };

/** UTF-8 text to base64 (player names may have accents; `btoa` alone only takes Latin-1). */
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  // Chunked so `String.fromCharCode` never gets too many arguments.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Base64 (GitHub wraps it with newlines) to UTF-8 text. */
export function decodeBase64(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function githubMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const { message } = body;
    if (typeof message === 'string' && message !== '') {
      return message.split('\n')[0]!;
    }
  }
  return 'no message';
}

/** Primary and secondary rate limits: 403 or 429 with rate-limit headers or message. */
export function isRateLimited(response: GitHubResponse): boolean {
  if (response.status !== 403 && response.status !== 429) {
    return false;
  }
  return (
    response.status === 429 ||
    response.headers.get('x-ratelimit-remaining') === '0' ||
    response.headers.has('retry-after') ||
    /rate limit/i.test(githubMessage(response.body))
  );
}

/** Maps a non-2xx response to a storage error. `what` names the request, never the token. */
export function responseError(
  response: GitHubResponse,
  operation: GitHubOperation,
  what: string,
): StorageError {
  const { status } = response;
  const detail = `GitHub answered ${status} on ${what}: ${githubMessage(response.body)}`;
  if (status === 401) {
    return { code: 'UNAUTHORIZED', message: detail };
  }
  if (isRateLimited(response)) {
    return {
      code: 'UNAVAILABLE',
      message: `GitHub rate limit reached, try again later (${detail})`,
    };
  }
  if (status === 403) {
    return { code: 'UNAUTHORIZED', message: detail };
  }
  if (status === 404) {
    const missingFile = operation === 'read' || operation === 'list' || operation === 'delete';
    return { code: missingFile ? 'NOT_FOUND' : 'UNAUTHORIZED', message: detail };
  }
  if ((status === 409 || status === 422) && (operation === 'write' || operation === 'delete')) {
    return { code: 'CONFLICT', message: detail };
  }
  return { code: 'UNAVAILABLE', message: detail };
}

const FileSchema = z.object({
  type: z.literal('file'),
  sha: z.string(),
  encoding: z.string(),
  content: z.string(),
});

const BlobSchema = z.object({
  sha: z.string(),
  encoding: z.literal('base64'),
  content: z.string(),
});

export const DirectoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  sha: z.string(),
  type: z.string(),
});
export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>;

const WriteResponseSchema = z.object({ content: z.object({ sha: z.string() }) });

function unexpected(what: string): StorageError {
  return { code: 'UNAVAILABLE', message: `Unexpected GitHub response on ${what}` };
}

/** Thin client over the five GitHub endpoints the backend uses. Default branch only. */
export class GitHubClient {
  private readonly target: GitHubTarget;
  private readonly base: string;

  constructor(target: GitHubTarget) {
    this.target = target;
    this.base = `${GITHUB_API}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
  }

  /** One request. Only a `fetch` that throws (offline, DNS, CORS) is an error here. */
  async request(
    method: 'GET' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<Result<GitHubResponse, StorageError>> {
    const fetchFn = this.target.fetch ?? fetch;
    let response: Response;
    try {
      response = await fetchFn(`${this.base}${path}`, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${this.target.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err({ code: 'UNAVAILABLE', message });
    }
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      // Empty or non-JSON body (e.g. an HTML 5xx page).
    }
    return ok({ status: response.status, headers: response.headers, body: parsed });
  }

  /** `GET /repos/{owner}/{repo}`, raw: `testConnection` maps the status itself. */
  getRepository(): Promise<Result<GitHubResponse, StorageError>> {
    return this.request('GET', '');
  }

  /** Lists one directory. A missing directory is `NOT_FOUND`. */
  async listDirectory(path: string): Promise<Result<DirectoryEntry[], StorageError>> {
    const what = `list ${path}`;
    const response = await this.request('GET', `/contents/${encodePath(path)}`);
    if (!response.ok) {
      return response;
    }
    if (response.value.status !== 200) {
      return err(responseError(response.value, 'list', what));
    }
    const parsed = z.array(DirectoryEntrySchema).safeParse(response.value.body);
    return parsed.success ? ok(parsed.data) : err(unexpected(what));
  }

  /** Reads one file as UTF-8 text, through the blob endpoint when it is over 1 MB. */
  async readFile(path: string): Promise<Result<{ text: string; sha: string }, StorageError>> {
    const what = `read ${path}`;
    const response = await this.request('GET', `/contents/${encodePath(path)}`);
    if (!response.ok) {
      return response;
    }
    if (response.value.status !== 200) {
      return err(responseError(response.value, 'read', what));
    }
    const file = FileSchema.safeParse(response.value.body);
    if (!file.success) {
      return err(unexpected(what));
    }
    const { sha, encoding, content } = file.data;
    if (encoding === 'base64') {
      return ok({ text: decodeBase64(content), sha });
    }
    if (encoding !== 'none') {
      return err(unexpected(what));
    }
    const blob = await this.request('GET', `/git/blobs/${encodeURIComponent(sha)}`);
    if (!blob.ok) {
      return blob;
    }
    if (blob.value.status !== 200) {
      return err(responseError(blob.value, 'read', what));
    }
    const parsedBlob = BlobSchema.safeParse(blob.value.body);
    return parsedBlob.success
      ? ok({ text: decodeBase64(parsedBlob.data.content), sha })
      : err(unexpected(what));
  }

  /** Creates (`sha` null) or replaces a file. Returns the new blob SHA. */
  async writeFile(
    path: string,
    text: string,
    sha: string | null,
    message: string,
  ): Promise<Result<{ sha: string }, StorageError>> {
    const what = `write ${path}`;
    const response = await this.request('PUT', `/contents/${encodePath(path)}`, {
      message,
      content: encodeBase64(text),
      ...(sha === null ? {} : { sha }),
    });
    if (!response.ok) {
      return response;
    }
    if (response.value.status !== 200 && response.value.status !== 201) {
      return err(responseError(response.value, 'write', what));
    }
    const parsed = WriteResponseSchema.safeParse(response.value.body);
    return parsed.success ? ok({ sha: parsed.data.content.sha }) : err(unexpected(what));
  }

  async deleteFile(
    path: string,
    sha: string,
    message: string,
  ): Promise<Result<void, StorageError>> {
    const response = await this.request('DELETE', `/contents/${encodePath(path)}`, {
      message,
      sha,
    });
    if (!response.ok) {
      return response;
    }
    if (response.value.status !== 200) {
      return err(responseError(response.value, 'delete', `delete ${path}`));
    }
    return ok(undefined);
  }
}
