import { useInterval } from '@mantine/hooks';
import { useEffect, useRef, useState } from 'react';
import { remainingMs, type TimerState } from '../../domain';

/** How often a running clock re-renders. The time itself always comes from `Date.now()`. */
export const TICK_MS = 250;

type Options = {
  /**
   * Called once when, while mounted, the remaining time goes from above 0 to 0 or below, for
   * any reason. A clock that is already in overtime when it mounts never calls it.
   */
  onTimeUp?: () => void;
  /** The round the timer belongs to. A change of round is never a time-up. */
  round?: number;
};

/** The remaining time of `timer` (negative in overtime), or null with no timer. */
export function useClock(
  timer: TimerState | null,
  { onTimeUp, round }: Options = {},
): number | null {
  const [now, setNow] = useState(() => Date.now());
  const interval = useInterval(() => setNow(Date.now()), TICK_MS);
  const running = timer?.kind === 'running';

  useEffect(() => {
    if (!running) {
      return;
    }
    // A timer started or changed since the last tick reads the current time at once.
    const first = setTimeout(() => setNow(Date.now()), 0);
    interval.start();
    return () => {
      clearTimeout(first);
      interval.stop();
    };
    // `interval` is a new object on every render; its functions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, timer]);

  const remaining = timer === null ? null : remainingMs(timer, running ? now : 0);

  const previous = useRef<{ round: number | undefined; remaining: number | null } | null>(null);
  useEffect(() => {
    const last = previous.current;
    previous.current = { round, remaining };
    if (
      last !== null &&
      last.round === round &&
      last.remaining !== null &&
      last.remaining > 0 &&
      remaining !== null &&
      remaining <= 0
    ) {
      onTimeUp?.();
    }
  }, [remaining, round, onTimeUp]);

  return remaining;
}
