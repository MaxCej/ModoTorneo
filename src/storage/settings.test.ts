import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSettings, readSettings, SETTINGS_KEY, writeSettings } from './settings';

const GITHUB = {
  backend: 'github',
  owner: 'alice',
  repo: 'mtg-data',
  token: 'github_pat_x',
} as const;

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('readSettings', () => {
  it('returns local storage when the key is missing', () => {
    expect(readSettings()).toEqual({ backend: 'local' });
  });

  it('returns local storage for invalid JSON', () => {
    localStorage.setItem(SETTINGS_KEY, '{not json');
    expect(readSettings()).toEqual({ backend: 'local' });
  });

  it('returns local storage for an invalid shape', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ backend: 'github', owner: 'alice' }));
    expect(readSettings()).toEqual({ backend: 'local' });
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ backend: 'dropbox' }));
    expect(readSettings()).toEqual({ backend: 'local' });
  });

  it('returns local storage when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readSettings()).toEqual({ backend: 'local' });
  });

  it('reads GitHub settings back', () => {
    writeSettings(GITHUB);
    expect(readSettings()).toEqual(GITHUB);
  });
});

describe('writeSettings and clearSettings', () => {
  it('writes local settings', () => {
    writeSettings(GITHUB);
    writeSettings({ backend: 'local' });
    expect(readSettings()).toEqual({ backend: 'local' });
    expect(localStorage.getItem(SETTINGS_KEY)).toBe('{"backend":"local"}');
  });

  it('clearSettings removes the key', () => {
    writeSettings(GITHUB);
    clearSettings();
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
    expect(readSettings()).toEqual({ backend: 'local' });
  });
});
