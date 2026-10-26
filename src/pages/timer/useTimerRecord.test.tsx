import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyTimerRecord, timerKey, type TimerRecord } from '../../storage/timerStorage';
import { useTimerRecord } from './useTimerRecord';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const RECORD: TimerRecord = {
  ...emptyTimerRecord('Cup'),
  timers: [{ round: 1, state: { kind: 'paused', remainingMs: 1_000 } }],
};

/** What another window's write looks like to this one. */
function storageEvent(key: string | null, value: string | null) {
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe('useTimerRecord', () => {
  it('reads the stored record', () => {
    localStorage.setItem(timerKey(ID), JSON.stringify(RECORD));
    const { result } = renderHook(() => useTimerRecord(ID));
    expect(result.current[0]).toEqual(RECORD);
  });

  it('writes to localStorage and returns the new record', () => {
    const { result } = renderHook(() => useTimerRecord(ID));
    expect(result.current[0]).toBeNull();
    act(() => result.current[1](RECORD));
    expect(result.current[0]).toEqual(RECORD);
    expect(JSON.parse(localStorage.getItem(timerKey(ID))!)).toEqual(RECORD);
  });

  it('follows a storage event for its key', () => {
    const { result } = renderHook(() => useTimerRecord(ID));
    storageEvent(timerKey(ID), JSON.stringify(RECORD));
    expect(result.current[0]).toEqual(RECORD);
    storageEvent(timerKey(ID), null);
    expect(result.current[0]).toBeNull();
  });

  it('ignores storage events for other keys', () => {
    localStorage.setItem(timerKey(ID), JSON.stringify(RECORD));
    const { result } = renderHook(() => useTimerRecord(ID));
    storageEvent(timerKey(OTHER), JSON.stringify(emptyTimerRecord('Other')));
    storageEvent('modotorneo.storage', '{"backend":"local"}');
    expect(result.current[0]).toEqual(RECORD);
  });

  it('reads an invalid value from another window as no record', () => {
    localStorage.setItem(timerKey(ID), JSON.stringify(RECORD));
    const { result } = renderHook(() => useTimerRecord(ID));
    storageEvent(timerKey(ID), '{broken');
    expect(result.current[0]).toBeNull();
  });

  it('switches records with the tournament', () => {
    localStorage.setItem(timerKey(ID), JSON.stringify(RECORD));
    const { result, rerender } = renderHook(({ id }) => useTimerRecord(id), {
      initialProps: { id: ID },
    });
    rerender({ id: OTHER });
    expect(result.current[0]).toBeNull();
  });
});
