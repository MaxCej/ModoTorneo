/**
 * One round's timer. Times are epoch milliseconds from `Date.now()`, always passed in by the
 * caller: this module never reads the clock.
 */
export type TimerState =
  | { kind: 'running'; endsAt: number }
  // `remainingMs` is negative when paused in overtime.
  | { kind: 'paused'; remainingMs: number };

export const MINUTE_MS = 60_000;

export function startTimer(minutes: number, now: number): TimerState {
  return { kind: 'running', endsAt: now + minutes * MINUTE_MS };
}

/** Remaining time; negative in overtime. */
export function remainingMs(timer: TimerState, now: number): number {
  return timer.kind === 'running' ? timer.endsAt - now : timer.remainingMs;
}

/** A paused timer stays as it is. */
export function pauseTimer(timer: TimerState, now: number): TimerState {
  return timer.kind === 'paused' ? timer : { kind: 'paused', remainingMs: timer.endsAt - now };
}

/** A running timer stays as it is. */
export function resumeTimer(timer: TimerState, now: number): TimerState {
  return timer.kind === 'running' ? timer : { kind: 'running', endsAt: now + timer.remainingMs };
}

/**
 * Adds `deltaMs` (±60 000 from the UI) to the remaining time. A negative delta never takes the
 * remaining time below 0, and leaves a timer at 0 or in overtime unchanged.
 */
export function adjustTimer(timer: TimerState, deltaMs: number, now: number): TimerState {
  const remaining = remainingMs(timer, now);
  if (deltaMs < 0 && remaining <= 0) {
    return timer;
  }
  const next = deltaMs < 0 ? Math.max(0, remaining + deltaMs) : remaining + deltaMs;
  return timer.kind === 'running'
    ? { kind: 'running', endsAt: now + next }
    : { kind: 'paused', remainingMs: next };
}
