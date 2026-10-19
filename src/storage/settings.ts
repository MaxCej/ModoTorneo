import { z } from 'zod';

/** `localStorage` key holding the chosen storage backend. */
export const SETTINGS_KEY = 'modotorneo.storage';

export const StorageSettingsSchema = z.discriminatedUnion('backend', [
  z.object({ backend: z.literal('local') }),
  z.object({
    backend: z.literal('github'),
    owner: z.string().min(1),
    repo: z.string().min(1),
    token: z.string().min(1),
  }),
]);
export type StorageSettings = z.infer<typeof StorageSettingsSchema>;

const LOCAL: StorageSettings = { backend: 'local' };

/** Missing, unreadable or invalid settings read as local storage. */
export function readSettings(): StorageSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) {
      return LOCAL;
    }
    const parsed = StorageSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : LOCAL;
  } catch {
    return LOCAL;
  }
}

export function writeSettings(settings: StorageSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(StorageSettingsSchema.parse(settings)));
}

export function clearSettings(): void {
  localStorage.removeItem(SETTINGS_KEY);
}
