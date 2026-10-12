export type PersistenceStatus = 'granted' | 'notGranted' | 'unsupported';

/** `navigator.storage` and the named method, or null when the browser lacks either. */
function storageMethod(name: 'persist' | 'persisted'): (() => Promise<boolean>) | null {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
  if (!storage || typeof storage[name] !== 'function') {
    return null;
  }
  return () => storage[name]();
}

async function status(name: 'persist' | 'persisted'): Promise<PersistenceStatus> {
  const method = storageMethod(name);
  if (!method) {
    return 'unsupported';
  }
  try {
    return (await method()) ? 'granted' : 'notGranted';
  } catch {
    return 'notGranted';
  }
}

/** Asks the browser not to evict IndexedDB data. Never throws. */
export function requestPersistence(): Promise<PersistenceStatus> {
  return status('persist');
}

/** Whether storage is already persistent. Never throws. */
export function getPersistence(): Promise<PersistenceStatus> {
  return status('persisted');
}
