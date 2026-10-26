import { z } from 'zod';
import type { TimerState, Uuid } from '../domain';

// Round timers (SPEC 13) live in this browser only, never in the tournament document.
// Every read and write swallows `localStorage` errors: the timer then works until reload.

/** `localStorage` key of one tournament's timer record. */
export function timerKey(tournamentId: Uuid): string {
  return `modotorneo.timer.${tournamentId}`;
}

export const DEFAULT_ROUND_MINUTES = 50;
export const MAX_ROUND_MINUTES = 180;

export const TimerStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('running'), endsAt: z.number().finite() }),
  z.object({ kind: z.literal('paused'), remainingMs: z.number().finite() }),
]) satisfies z.ZodType<TimerState>;

export const OpenRoundSchema = z.object({
  round: z.number().int().min(1),
  stage: z.enum(['swiss', 'topCut']),
  matches: z.number().int().min(0), // top cut round name comes from `topCutRoundName(matches)`
});
export type OpenRound = z.infer<typeof OpenRoundSchema>;

export const TimerRecordSchema = z.object({
  tournamentName: z.string(),
  // What the big timer shows. Written by the tournament page; null when no round is open.
  openRound: OpenRoundSchema.nullable(),
  timers: z.array(z.object({ round: z.number().int().min(1), state: TimerStateSchema })),
  minutes: z.number().int().min(1).max(MAX_ROUND_MINUTES), // last length used
});
export type TimerRecord = z.infer<typeof TimerRecordSchema>;

/** Missing, unreadable or invalid records read as null. */
export function readTimerRecord(tournamentId: Uuid): TimerRecord | null {
  try {
    const raw = localStorage.getItem(timerKey(tournamentId));
    return raw === null ? null : parseTimerRecord(raw);
  } catch {
    return null;
  }
}

/** Parses a stored record (also the `newValue` of a `storage` event); invalid is null. */
export function parseTimerRecord(raw: string): TimerRecord | null {
  try {
    const parsed = TimerRecordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeTimerRecord(tournamentId: Uuid, record: TimerRecord): void {
  try {
    localStorage.setItem(timerKey(tournamentId), JSON.stringify(TimerRecordSchema.parse(record)));
  } catch {
    // Full or blocked storage: the timer keeps working in memory.
  }
}

export function removeTimerRecord(tournamentId: Uuid): void {
  try {
    localStorage.removeItem(timerKey(tournamentId));
  } catch {
    // Blocked storage holds no record to remove.
  }
}

/** A record with no timers, for a tournament seen for the first time. */
export function emptyTimerRecord(tournamentName: string): TimerRecord {
  return { tournamentName, openRound: null, timers: [], minutes: DEFAULT_ROUND_MINUTES };
}

export function roundTimer(record: TimerRecord | null, round: number): TimerState | null {
  return record?.timers.find((entry) => entry.round === round)?.state ?? null;
}

/** Replaces the round's timer; null removes it. */
export function withRoundTimer(
  record: TimerRecord,
  round: number,
  state: TimerState | null,
): TimerRecord {
  const others = record.timers.filter((entry) => entry.round !== round);
  const timers = state === null ? others : [...others, { round, state }];
  return { ...record, timers: timers.sort((a, b) => a.round - b.round) };
}

/** Which view a mute toggle belongs to. One toggle per view, shared by every tournament. */
export type TimerView = 'page' | 'bigView';

function mutedKey(view: TimerView): string {
  return `modotorneo.timer.muted.${view}`;
}

export function readMuted(view: TimerView): boolean {
  try {
    return localStorage.getItem(mutedKey(view)) === 'true';
  } catch {
    return false;
  }
}

export function writeMuted(view: TimerView, muted: boolean): void {
  try {
    if (muted) {
      localStorage.setItem(mutedKey(view), 'true');
    } else {
      localStorage.removeItem(mutedKey(view));
    }
  } catch {
    // Blocked storage: the toggle lasts until reload.
  }
}
