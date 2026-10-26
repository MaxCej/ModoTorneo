import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyTimerRecord,
  readMuted,
  readTimerRecord,
  writeMuted,
  writeTimerRecord,
  type OpenRound,
} from '../../storage/timerStorage';
import { playBeep, unlockSound } from '../timer/beep';
import { useTimerRecord } from '../timer/useTimerRecord';
import { RoundTimer } from './RoundTimer';

const sound = vi.hoisted(() => ({ blocked: false }));
vi.mock('../timer/beep', () => ({
  playBeep: vi.fn(),
  unlockSound: vi.fn(),
  useSoundBlocked: () => sound.blocked,
}));

const ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-26T18:00:00Z').getTime();

const round = (n: number): OpenRound => ({ round: n, stage: 'swiss', matches: 4 });

/** The card wired as on the tournament page: one card per open round. */
function Harness({ openRound }: { openRound: OpenRound }) {
  const [record, setRecord] = useTimerRecord(ID);
  return (
    <RoundTimer
      key={openRound.round}
      tournamentName="Cup"
      openRound={openRound}
      record={record}
      onChange={setRecord}
    />
  );
}

function renderTimer(openRound = round(1)) {
  const view = render(
    <MantineProvider env="test">
      <Notifications />
      <Harness openRound={openRound} />
    </MantineProvider>,
  );
  return {
    showRound: (next: OpenRound) =>
      view.rerender(
        <MantineProvider env="test">
          <Notifications />
          <Harness openRound={next} />
        </MantineProvider>,
      ),
  };
}

const clock = () => screen.getByTestId('timer-clock').textContent;
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const minutesInput = () => screen.getByRole('textbox', { name: 'Minutes' });

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function start(minutes?: number) {
  if (minutes !== undefined) {
    fireEvent.change(minutesInput(), { target: { value: String(minutes) } });
  }
  click('Start');
  advance(0);
}

beforeEach(() => {
  localStorage.clear();
  sound.blocked = false;
  vi.mocked(playBeep).mockClear();
  vi.mocked(unlockSound).mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  act(() => notifications.clean());
  vi.useRealTimers();
});

describe('RoundTimer', () => {
  it('shows "Not started" with 50 minutes by default', () => {
    renderTimer();
    expect(screen.getByRole('heading', { name: 'Round 1 timer' })).toBeInTheDocument();
    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(minutesInput()).toHaveValue('50');
  });

  it('names a top cut round as its tab does', () => {
    renderTimer({ round: 4, stage: 'topCut', matches: 2 });
    expect(screen.getByRole('heading', { name: 'Semifinals timer' })).toBeInTheDocument();
  });

  it('counts down from the start and stores the timer', () => {
    renderTimer();
    start();
    expect(clock()).toBe('50:00');
    advance(10_000);
    expect(clock()).toBe('49:50');
    expect(readTimerRecord(ID)).toMatchObject({
      tournamentName: 'Cup',
      minutes: 50,
      timers: [{ round: 1, state: { kind: 'running', endsAt: NOW + 50 * 60_000 } }],
    });
  });

  it("remembers the last length for the next round's input", () => {
    const { showRound } = renderTimer();
    start(40);
    expect(clock()).toBe('40:00');
    showRound(round(2));
    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(minutesInput()).toHaveValue('40');
  });

  it('disables Start for an invalid length', () => {
    renderTimer();
    fireEvent.change(minutesInput(), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('pauses and resumes from the same value', () => {
    renderTimer();
    start(1);
    advance(15_000);
    click('Pause');
    expect(clock()).toBe('00:45');
    expect(screen.getByText('Paused')).toBeInTheDocument();
    advance(60_000);
    expect(clock()).toBe('00:45');
    click('Resume');
    advance(5_000);
    expect(clock()).toBe('00:40');
    expect(screen.queryByText('Paused')).not.toBeInTheDocument();
  });

  it('adds and removes a minute, never below zero', () => {
    renderTimer();
    start(2);
    click('+1 min');
    advance(0);
    expect(clock()).toBe('03:00');
    click('−1 min');
    advance(0);
    expect(clock()).toBe('02:00');
    advance(90_000);
    click('−1 min');
    advance(0);
    expect(clock()).toBe('+00:00');
    expect(screen.getByText('Time')).toBeInTheDocument();
  });

  it('shows overtime past zero and disables −1 min there', () => {
    renderTimer();
    start(1);
    advance(65_000);
    expect(clock()).toBe('+00:05');
    expect(screen.getByText('Time')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '−1 min' })).toBeDisabled();
    click('+1 min');
    advance(0);
    expect(clock()).toBe('00:55');
  });

  it('resets after confirmation', () => {
    renderTimer();
    start();
    click('Reset');
    expect(screen.getByText('Reset the timer for this round?')).toBeInTheDocument();
    click('Cancel');
    expect(clock()).toBe('50:00');

    click('Reset');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset' }));
    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(readTimerRecord(ID)?.timers).toEqual([]);
  });

  it("keeps each round's timer: round 3 starts fresh, round 2 shows again on rollback", () => {
    const { showRound } = renderTimer(round(2));
    start(1);
    advance(20_000);
    showRound(round(3));
    expect(screen.getByText('Not started')).toBeInTheDocument();
    advance(60_000);
    showRound(round(2));
    advance(0);
    expect(clock()).toBe('+00:20');
  });
});

describe('RoundTimer time-up alert', () => {
  it('beeps once and shows a notification when the countdown reaches zero', () => {
    renderTimer();
    start(1);
    expect(unlockSound).toHaveBeenCalledTimes(1);
    advance(59_000);
    expect(playBeep).not.toHaveBeenCalled();
    advance(2_000);
    expect(playBeep).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Round 1: time is up')).toBeInTheDocument();
    advance(30_000);
    expect(playBeep).toHaveBeenCalledTimes(1);
  });

  it('does not beep when loaded already in overtime', () => {
    writeTimerRecord(ID, {
      ...emptyTimerRecord('Cup'),
      timers: [{ round: 1, state: { kind: 'running', endsAt: NOW - 5_000 } }],
    });
    renderTimer();
    advance(5_000);
    expect(screen.getByText('Time')).toBeInTheDocument();
    expect(playBeep).not.toHaveBeenCalled();
    expect(screen.queryByText('Round 1: time is up')).not.toBeInTheDocument();
  });

  it('beeps when −1 min takes the clock to zero', () => {
    renderTimer();
    start(1);
    advance(30_000);
    click('−1 min');
    advance(0);
    expect(playBeep).toHaveBeenCalledTimes(1);
  });

  it('shows the notification but does not beep when muted, and remembers the mute', () => {
    renderTimer();
    click('Mute timer sound');
    expect(readMuted('page')).toBe(true);
    expect(readMuted('bigView')).toBe(false);
    expect(screen.getByRole('button', { name: 'Unmute timer sound' })).toBeInTheDocument();
    start(1);
    advance(61_000);
    expect(playBeep).not.toHaveBeenCalled();
    expect(screen.getByText('Round 1: time is up')).toBeInTheDocument();
  });

  it('starts muted when the page view was muted before', () => {
    writeMuted('page', true);
    renderTimer();
    expect(screen.getByRole('button', { name: 'Unmute timer sound' })).toBeInTheDocument();
  });

  it('offers "Enable sound" while the browser blocks audio and a timer exists', () => {
    sound.blocked = true;
    renderTimer();
    expect(screen.queryByRole('button', { name: 'Enable sound' })).not.toBeInTheDocument();
    start(1);
    vi.mocked(unlockSound).mockClear();
    click('Enable sound');
    expect(unlockSound).toHaveBeenCalledTimes(1);
    click('Mute timer sound');
    expect(screen.queryByRole('button', { name: 'Enable sound' })).not.toBeInTheDocument();
  });
});
