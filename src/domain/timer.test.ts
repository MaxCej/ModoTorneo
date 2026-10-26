import { describe, expect, it } from 'vitest';
import {
  adjustTimer,
  MINUTE_MS,
  pauseTimer,
  remainingMs,
  resumeTimer,
  startTimer,
  type TimerState,
} from './timer';
import timerSource from './timer.ts?raw';

const NOW = 1_800_000_000_000;

describe('startTimer', () => {
  it('ends the given minutes from now', () => {
    expect(startTimer(50, NOW)).toEqual({ kind: 'running', endsAt: NOW + 50 * 60_000 });
  });
});

describe('remainingMs', () => {
  it('counts down while running and is negative past the end', () => {
    const timer = startTimer(1, NOW);
    expect(remainingMs(timer, NOW + 20_000)).toBe(40_000);
    expect(remainingMs(timer, NOW + MINUTE_MS + 5_000)).toBe(-5_000);
  });

  it('stays fixed while paused', () => {
    const timer: TimerState = { kind: 'paused', remainingMs: 30_000 };
    expect(remainingMs(timer, NOW)).toBe(30_000);
    expect(remainingMs(timer, NOW + 10 * MINUTE_MS)).toBe(30_000);
  });
});

describe('pauseTimer and resumeTimer', () => {
  it('keeps the remaining time across a pause of any length', () => {
    const paused = pauseTimer(startTimer(50, NOW), NOW + 10 * MINUTE_MS);
    expect(paused).toEqual({ kind: 'paused', remainingMs: 40 * MINUTE_MS });
    const resumed = resumeTimer(paused, NOW + 95 * MINUTE_MS);
    expect(remainingMs(resumed, NOW + 95 * MINUTE_MS)).toBe(40 * MINUTE_MS);
  });

  it('keeps overtime when paused in overtime', () => {
    const paused = pauseTimer(startTimer(1, NOW), NOW + MINUTE_MS + 7_000);
    expect(paused).toEqual({ kind: 'paused', remainingMs: -7_000 });
  });

  it('changes nothing when pausing a paused timer or resuming a running one', () => {
    const paused: TimerState = { kind: 'paused', remainingMs: 1_000 };
    const running = startTimer(5, NOW);
    expect(pauseTimer(paused, NOW + 5_000)).toBe(paused);
    expect(resumeTimer(running, NOW + 5_000)).toBe(running);
  });
});

describe('adjustTimer', () => {
  it('adds a minute to a running and to a paused timer', () => {
    const running = startTimer(10, NOW);
    expect(remainingMs(adjustTimer(running, MINUTE_MS, NOW + 1_000), NOW + 1_000)).toBe(
      10 * MINUTE_MS - 1_000 + MINUTE_MS,
    );
    expect(adjustTimer({ kind: 'paused', remainingMs: 5_000 }, MINUTE_MS, NOW)).toEqual({
      kind: 'paused',
      remainingMs: 65_000,
    });
  });

  it('adds a minute in overtime, back above zero', () => {
    const late = startTimer(1, NOW);
    const at = NOW + MINUTE_MS + 20_000;
    const adjusted = adjustTimer(late, MINUTE_MS, at);
    expect(adjusted.kind).toBe('running');
    expect(remainingMs(adjusted, at)).toBe(40_000);
    expect(adjustTimer({ kind: 'paused', remainingMs: -90_000 }, MINUTE_MS, NOW)).toEqual({
      kind: 'paused',
      remainingMs: -30_000,
    });
  });

  it('removes a minute', () => {
    const running = startTimer(10, NOW);
    expect(remainingMs(adjustTimer(running, -MINUTE_MS, NOW), NOW)).toBe(9 * MINUTE_MS);
    expect(adjustTimer({ kind: 'paused', remainingMs: 90_000 }, -MINUTE_MS, NOW)).toEqual({
      kind: 'paused',
      remainingMs: 30_000,
    });
  });

  it('clamps a removed minute at zero', () => {
    const running = startTimer(10, NOW);
    const at = NOW + 10 * MINUTE_MS - 20_000;
    expect(adjustTimer(running, -MINUTE_MS, at)).toEqual({ kind: 'running', endsAt: at });
    expect(adjustTimer({ kind: 'paused', remainingMs: 20_000 }, -MINUTE_MS, NOW)).toEqual({
      kind: 'paused',
      remainingMs: 0,
    });
  });

  it('leaves a timer at zero or in overtime unchanged when removing a minute', () => {
    const zero: TimerState = { kind: 'paused', remainingMs: 0 };
    const overtime: TimerState = { kind: 'paused', remainingMs: -5_000 };
    const late = startTimer(1, NOW);
    expect(adjustTimer(zero, -MINUTE_MS, NOW)).toBe(zero);
    expect(adjustTimer(overtime, -MINUTE_MS, NOW)).toBe(overtime);
    expect(adjustTimer(late, -MINUTE_MS, NOW + 2 * MINUTE_MS)).toBe(late);
  });
});

describe('timer module', () => {
  it('never reads the clock', () => {
    const code = timerSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/Date\.now|new Date|performance\.now/);
  });
});
