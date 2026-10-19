import { z } from 'zod';
import { GitHubClient, isRateLimited, responseError } from './client';

export type ConnectionCheck =
  | { ok: true; fullName: string; private: boolean }
  | {
      ok: false;
      reason: 'unauthorized' | 'notFound' | 'readOnly' | 'unavailable';
      message: string;
    };

const RepositorySchema = z.object({
  full_name: z.string(),
  private: z.boolean(),
  permissions: z.object({ push: z.boolean().optional() }).optional(),
});

/** Checks that the token can see and write the repository: `GET /repos/{owner}/{repo}`. */
export async function testConnection(
  input: { owner: string; repo: string; token: string },
  fetchFn?: typeof fetch,
): Promise<ConnectionCheck> {
  const client = new GitHubClient({ ...input, fetch: fetchFn });
  const response = await client.getRepository();
  if (!response.ok) {
    return { ok: false, reason: 'unavailable', message: response.error.message };
  }
  const { status } = response.value;
  const what = `${input.owner}/${input.repo}`;
  if (status === 200) {
    const repository = RepositorySchema.safeParse(response.value.body);
    if (!repository.success) {
      return { ok: false, reason: 'unavailable', message: `Unexpected GitHub response on ${what}` };
    }
    const { full_name: fullName, private: isPrivate, permissions } = repository.data;
    if (permissions?.push !== true) {
      return { ok: false, reason: 'readOnly', message: `The token cannot write to ${fullName}` };
    }
    return { ok: true, fullName, private: isPrivate };
  }
  const { message } = responseError(response.value, 'repo', what);
  if ((status === 401 || status === 403) && !isRateLimited(response.value)) {
    return { ok: false, reason: 'unauthorized', message };
  }
  if (status === 404) {
    return { ok: false, reason: 'notFound', message };
  }
  return { ok: false, reason: 'unavailable', message };
}
