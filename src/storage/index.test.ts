import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_KEY } from './settings';

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('getStorage', () => {
  it('returns the Dexie backend without settings', async () => {
    const { getStorage, DexieBackend } = await import('./index');
    expect(getStorage()).toBeInstanceOf(DexieBackend);
  });

  it('returns the GitHub backend when the settings say github, once per page load', async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ backend: 'github', owner: 'alice', repo: 'mtg-data', token: 't' }),
    );
    const { getStorage, GitHubBackend } = await import('./index');
    const storage = getStorage();
    expect(storage).toBeInstanceOf(GitHubBackend);
    localStorage.clear();
    expect(getStorage()).toBe(storage);
  });
});
