import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emptyTimerRecord,
  readMuted,
  readTimerRecord,
  removeTimerRecord,
  roundTimer,
  timerKey,
  withRoundTimer,
  writeMuted,
  writeTimerRecord,
  type TimerRecord,
} from './timerStorage';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const RECORD: TimerRecord = {
  tournamentName: 'Friday Modern',
  openRound: { round: 2, stage: 'swiss', matches: 4 },
  timers: [
    { round: 1, state: { kind: 'paused', remainingMs: -3_000 } },
    { round: 2, state: { kind: 'running', endsAt: 1_800_000_000_000 } },
  ],
  minutes: 40,
};

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('readTimerRecord and writeTimerRecord', () => {
  it('reads a written record back', () => {
    writeTimerRecord(ID, RECORD);
    expect(localStorage.getItem('modotorneo.timer.' + ID)).not.toBeNull();
    expect(readTimerRecord(ID)).toEqual(RECORD);
  });

  it('reads a missing record as null', () => {
    expect(readTimerRecord(ID)).toBeNull();
  });

  it('reads unparseable JSON as null', () => {
    localStorage.setItem(timerKey(ID), '{not json');
    expect(readTimerRecord(ID)).toBeNull();
  });

  it('reads schema-invalid values as null', () => {
    localStorage.setItem(timerKey(ID), JSON.stringify({ ...RECORD, minutes: 0 }));
    expect(readTimerRecord(ID)).toBeNull();
    localStorage.setItem(
      timerKey(ID),
      JSON.stringify({ ...RECORD, timers: [{ round: 1, state: { kind: 'stopped' } }] }),
    );
    expect(readTimerRecord(ID)).toBeNull();
    localStorage.setItem(timerKey(ID), JSON.stringify({ ...RECORD, openRound: { round: 0 } }));
    expect(readTimerRecord(ID)).toBeNull();
  });

  it('reads null and writes nothing when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readTimerRecord(ID)).toBeNull();
    expect(() => writeTimerRecord(ID, RECORD)).not.toThrow();
    expect(() => removeTimerRecord(ID)).not.toThrow();
    expect(readMuted('page')).toBe(false);
    expect(() => writeMuted('page', true)).not.toThrow();
  });
});

describe('removeTimerRecord', () => {
  it("removes only that tournament's record", () => {
    writeTimerRecord(ID, RECORD);
    writeTimerRecord(OTHER, RECORD);
    removeTimerRecord(ID);
    expect(readTimerRecord(ID)).toBeNull();
    expect(readTimerRecord(OTHER)).toEqual(RECORD);
  });
});

describe('round timers in a record', () => {
  it('starts empty with 50 minutes', () => {
    expect(emptyTimerRecord('Cup')).toEqual({
      tournamentName: 'Cup',
      openRound: null,
      timers: [],
      minutes: 50,
    });
  });

  it("finds a round's timer", () => {
    expect(roundTimer(RECORD, 2)).toEqual({ kind: 'running', endsAt: 1_800_000_000_000 });
    expect(roundTimer(RECORD, 3)).toBeNull();
    expect(roundTimer(null, 1)).toBeNull();
  });

  it("replaces and removes a round's timer", () => {
    const replaced = withRoundTimer(RECORD, 1, { kind: 'paused', remainingMs: 5 });
    expect(replaced.timers).toEqual([
      { round: 1, state: { kind: 'paused', remainingMs: 5 } },
      RECORD.timers[1],
    ]);
    expect(withRoundTimer(RECORD, 2, null).timers).toEqual([RECORD.timers[0]]);
  });
});

describe('mute toggles', () => {
  it('are off by default and kept per view', () => {
    expect(readMuted('page')).toBe(false);
    expect(readMuted('bigView')).toBe(false);
    writeMuted('page', true);
    expect(readMuted('page')).toBe(true);
    expect(readMuted('bigView')).toBe(false);
    expect(localStorage.getItem('modotorneo.timer.muted.page')).toBe('true');
    writeMuted('page', false);
    expect(readMuted('page')).toBe(false);
    expect(localStorage.getItem('modotorneo.timer.muted.page')).toBeNull();
  });
});
