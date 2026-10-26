import { useCallback, useEffect, useState } from 'react';
import type { Uuid } from '../../domain';
import {
  parseTimerRecord,
  readTimerRecord,
  timerKey,
  writeTimerRecord,
  type TimerRecord,
} from '../../storage/timerStorage';

/** The tournament's timer record, kept in sync with other windows through the `storage` event. */
export function useTimerRecord(
  tournamentId: Uuid,
): [TimerRecord | null, (next: TimerRecord) => void] {
  // Tagged with its tournament, so switching tournaments never shows the previous record.
  const [held, setHeld] = useState(() => ({
    id: tournamentId,
    record: readTimerRecord(tournamentId),
  }));
  const record = held.id === tournamentId ? held.record : readTimerRecord(tournamentId);

  useEffect(() => {
    const key = timerKey(tournamentId);
    function onStorage(event: StorageEvent) {
      // A null key means another window cleared all of localStorage.
      if (event.key === key || event.key === null) {
        const next = event.newValue === null ? null : parseTimerRecord(event.newValue);
        setHeld({ id: tournamentId, record: event.key === null ? null : next });
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [tournamentId]);

  const write = useCallback(
    (next: TimerRecord) => {
      writeTimerRecord(tournamentId, next);
      setHeld({ id: tournamentId, record: next });
    },
    [tournamentId],
  );

  return [record, write];
}
