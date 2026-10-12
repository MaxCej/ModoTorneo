import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPersistence, requestPersistence } from './persist';

function stubStorage(storage: unknown) {
  vi.stubGlobal('navigator', { storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each([
  ['requestPersistence', requestPersistence, 'persist'],
  ['getPersistence', getPersistence, 'persisted'],
] as const)('%s', (_name, call, method) => {
  it('returns granted when the browser answers true', async () => {
    stubStorage({ [method]: vi.fn().mockResolvedValue(true) });
    await expect(call()).resolves.toBe('granted');
  });

  it('returns notGranted when the browser answers false', async () => {
    stubStorage({ [method]: vi.fn().mockResolvedValue(false) });
    await expect(call()).resolves.toBe('notGranted');
  });

  it('returns unsupported when navigator.storage is undefined', async () => {
    stubStorage(undefined);
    await expect(call()).resolves.toBe('unsupported');
  });

  it('returns unsupported when the method is missing', async () => {
    stubStorage({});
    await expect(call()).resolves.toBe('unsupported');
  });

  it('does not throw when the browser rejects', async () => {
    stubStorage({ [method]: vi.fn().mockRejectedValue(new Error('denied')) });
    await expect(call()).resolves.toBe('notGranted');
  });

  it('does not throw when the method throws synchronously', async () => {
    stubStorage({
      [method]: () => {
        throw new Error('broken');
      },
    });
    await expect(call()).resolves.toBe('notGranted');
  });
});
