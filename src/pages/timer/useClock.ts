import { useInterval } from '@mantine/hooks';
import { useEffect, useState } from 'react';
import { remainingMs, type TimerState } from '../../domain';

/** How often a running clock re-renders. The time itself always comes from `Date.now()`. */
export const TICK_MS = 250;

/** The remaining time of `timer` (negative in overtime), or null with no timer. */
export function useClock(timer: TimerState | null): number | null {
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

  return timer === null ? null : remainingMs(timer, running ? now : 0);
}
